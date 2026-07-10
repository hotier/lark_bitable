/**
 * DAG 工作流执行引擎
 *
 * 节点执行通过 NodeRegistry 统一派发，不再使用 switch-case。
 * 拓扑排序 + 变量传递保持不变。
 */

import type { Workflow, WorkflowNode, Execution, ExecutionStep, TriggerKind } from '@/types';
import { appendExecution } from '@/lib/execution-store';
import { nodeRegistry, type ExecutionContext } from './node-registry';

// 确保插件已注册（元数据 + 执行器）
import './plugins';
import './plugins/executors';

// ====== 拓扑排序 ======

interface EdgeDef {
  source: string;
  target: string;
}

function topologicalSort(nodes: WorkflowNode[], edges: EdgeDef[]): WorkflowNode[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const n of nodes) {
    inDegree.set(n.id, 0);
    adjacency.set(n.id, []);
  }

  for (const e of edges) {
    adjacency.get(e.source)?.push(e.target);
    inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const result: WorkflowNode[] = [];
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  while (queue.length > 0) {
    queue.sort((a, b) => {
      const na = nodeMap.get(a);
      const nb = nodeMap.get(b);
      if (na?.type === 'trigger') return -1;
      if (nb?.type === 'trigger') return 1;
      return 0;
    });

    const current = queue.shift()!;
    const node = nodeMap.get(current);
    if (node) result.push(node);

    for (const next of adjacency.get(current) || []) {
      const newDeg = (inDegree.get(next) || 1) - 1;
      inDegree.set(next, newDeg);
      if (newDeg === 0) queue.push(next);
    }
  }

  return result;
}

// ====== DAG 执行入口 ======

export async function executeWorkflow(
  workflow: Workflow,
  webhookContent: Record<string, unknown>,
  secretToken?: string,
  webhookUrl?: string,
): Promise<{ code: number; msg: string; data?: Record<string, unknown> }> {
  const startTime = Date.now();

  // 0. 状态闸门：无论何种触发器（webhook / 定时 / 表格事件），
  //    仅 enabled 的工作流允许执行，disabled / draft 直接拒绝，且不写入执行日志
  if (workflow.status !== 'enabled') {
    return {
      code: 4,
      msg: `workflow is ${workflow.status}, not enabled`,
    };
  }

  // 1. 构建边列表 — 优先使用持久化的边，回退到按数组顺序线性连接（向后兼容）
  const edges: EdgeDef[] = [];
  if (workflow.edges && workflow.edges.length > 0) {
    // 使用保存的拓扑
    for (const we of workflow.edges) {
      edges.push({ source: we.source, target: we.target });
    }
  } else {
    // 回退：按节点数组顺序线性连接
    const actionNodes = workflow.nodes.filter(
      (n) => n.type !== 'trigger' && n.type !== 'end',
    );
    const triggerNode = workflow.nodes.find((n) => n.type === 'trigger');
    const endNode = workflow.nodes.find((n) => n.type === 'end');

    if (triggerNode && actionNodes.length > 0) {
      edges.push({ source: triggerNode.id, target: actionNodes[0].id });
      for (let i = 0; i < actionNodes.length - 1; i++) {
        edges.push({ source: actionNodes[i].id, target: actionNodes[i + 1].id });
      }
      edges.push({ source: actionNodes[actionNodes.length - 1].id, target: endNode?.id || triggerNode.id });
    } else if (triggerNode && endNode) {
      edges.push({ source: triggerNode.id, target: endNode.id });
    }
  }

  // 2. 拓扑排序
  const sorted = topologicalSort(workflow.nodes, edges);

  // 3. 执行上下文
  const ctx: ExecutionContext = {
    webhookContent,
    nodeOutputs: new Map(),
    steps: [],
    startTime,
    hasFailure: false,
    stopped: false,
  };

  // 4. 按拓扑序执行（通过 Registry 派发）
  for (const node of sorted) {
    if (ctx.stopped) break;
    if (node.type === 'trigger' || node.type === 'end') continue;

    const step = await nodeRegistry.execute(node, ctx);
    ctx.steps.push(step);

    if (step.output) {
      ctx.nodeOutputs.set(node.id, step.output);
    }

    if (!step.success) {
      ctx.hasFailure = true;
      if (node.type === 'filter') {
        ctx.stopped = true;
      }
    }
  }

  // 5. 写入执行日志
  const totalDuration = Date.now() - startTime;

  // 从触发节点读取触发器类型与配置，作为动态触发来源展示
  const triggerNode = workflow.nodes.find((n) => n.type === 'trigger');
  const triggerCfg = triggerNode?.triggerConfig;
  const triggerKind: TriggerKind = triggerCfg?.triggerKind ?? 'webhook';
  const triggerDetail: Record<string, unknown> = {
    // 优先使用路由实际匹配的 webhook 路径（保证地址恒非空），回退到触发器配置
    webhookUrl: webhookUrl || triggerCfg?.webhookUrl,
    ...(triggerKind === 'scheduled'
      ? { cronExpression: triggerCfg?.cronExpression }
      : {}),
    ...(triggerKind === 'bitable_event'
      ? {
          eventAppToken: triggerCfg?.eventAppToken,
          eventTableId: triggerCfg?.eventTableId,
          eventType: triggerCfg?.eventType,
        }
      : {}),
  };

  const execution: Execution = {
    id: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    workflowId: workflow.id,
    workflowName: workflow.name,
    status: ctx.hasFailure ? 'failure' : 'success',
    triggerTime: new Date().toISOString(),
    durationMs: totalDuration,
    requestSummary: {
      content: webhookContent,
      token: secretToken,
    },
    steps: ctx.steps,
    triggerKind,
    triggerDetail,
  };
  await appendExecution(execution);

  const results = ctx.steps.map((s) => `${s.success ? '✓' : '✗'} ${s.title}: ${s.message}`);
  return {
    code: 0,
    msg: ctx.hasFailure ? '部分步骤失败' : 'ok',
    data: { workflowName: workflow.name, results },
  };
}
