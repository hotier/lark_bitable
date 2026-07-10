import { Client, withUserAccessToken } from '@larksuiteoapi/node-sdk';
import { loadTokenSync, saveToken, deleteToken, reloadToken } from '@/lib/token-store';
import { withCache, cacheKey, cacheDel, cacheDelByPrefix, TTL } from '@/lib/cache';
import type {
  BitableRecord,
  ListRecordsData,
  ListTablesData,
  Table,
  App,
  Field,
  FieldType,
  DriveFileType,
  UserProfile,
} from '@/types';

// ====== 飞书字段类型数字 → 字符串映射 ======
const FIELD_TYPE_MAP: Record<number, FieldType> = {
  1: 'text',
  2: 'number',
  3: 'single_select',
  4: 'multi_select',
  5: 'date',
  7: 'checkbox',
  11: 'person',
  15: 'url',
  17: 'file',
  18: 'phone',
  20: 'formula',
  21: 'lookup',
  1001: 'created_time',
  1002: 'created_by',
  1003: 'updated_by',
  1004: 'updated_time',
};

/** 抛出带飞书错误码的业务异常 */
function throwFeishuError(prefix: string, code: number | undefined, msg: string | undefined): never {
  const err = new Error(`${prefix} [${code}]: ${msg || '未知错误'}`) as any;
  err.feishuCode = code;
  err.feishuMsg = msg;
  throw err;
}

// ====== 服务类 ======

class FeishuBitable {
  private client: Client;

  /** 存储 OAuth 登录后的用户 token，供 webhook 等无法显式传 token 的场景使用 */
  private userAccessToken: string | null = null;
  private userTokenExpireTime = 0;
  private refreshToken: string | null = null;
  private refreshTokenExpireTime = 0;

  private appId = process.env.APP_ID || '';

  constructor() {
    this.client = new Client({
      appId: process.env.APP_ID || '',
      appSecret: process.env.APP_SECRET || '',
    });

    // 构造时尝试从内存缓存恢复 token（持久化存储 + 内存缓存层）
    // 冷启动时缓存为空 → ensureAuth() 会从数据库兜底恢复
    const stored = loadTokenSync();
    if (stored) {
      if (Date.now() < stored.accessTokenExpireAt) {
        this.userAccessToken = stored.accessToken;
        this.userTokenExpireTime = stored.accessTokenExpireAt;
        this.refreshToken = stored.refreshToken;
        this.refreshTokenExpireTime = stored.refreshTokenExpireAt;
        console.log('[FeishuBitable] 从内存缓存恢复了有效的 user token');
      } else if (Date.now() < stored.refreshTokenExpireAt) {
        this.refreshToken = stored.refreshToken;
        this.refreshTokenExpireTime = stored.refreshTokenExpireAt;
        console.log('[FeishuBitable] access_token 已过期，refresh_token 仍有效');
      } else {
        console.log('[FeishuBitable] 缓存 token 已全部过期，需要重新登录');
      }
    }
  }

  // ====== Token 管理（OAuth + 持久化存储） ======

  /** 用 OAuth code 换取 user_access_token，同时存入类实例供 webhook 使用 */
  async getUserAccessToken(code: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expire: number;
  }> {
    const res = await this.client.authen.oidcAccessToken.create({
      data: {
        grant_type: 'authorization_code',
        code,
      },
    });

    if (res.code !== 0) {
      throwFeishuError('获取UserAccessToken失败', res.code, res.msg);
    }

    const data = res.data!;
    this.userAccessToken = data.access_token;
    this.userTokenExpireTime = Date.now() + ((data.expires_in || 7200) - 60) * 1000;
    if (data.refresh_token) {
      this.refreshToken = data.refresh_token;
      this.refreshTokenExpireTime =
        Date.now() + ((data.refresh_expires_in || 604800) - 60) * 1000;
    }

    // 持久化到文件，确保服务重启后 webhook 继续可用
    await saveToken({
      accessToken: this.userAccessToken,
      accessTokenExpireAt: this.userTokenExpireTime,
      refreshToken: this.refreshToken || '',
      refreshTokenExpireAt: this.refreshTokenExpireTime,
    });

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || '',
      expire: data.expires_in || 7200,
    };
  }

  /** 刷新 user_access_token */
  async refreshUserAccessToken(): Promise<{ accessToken: string; expire: number }> {
    if (!this.refreshToken) {
      throw new Error('没有 refresh_token，无法刷新');
    }

    const res = await this.client.authen.oidcRefreshAccessToken.create({
      data: {
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken,
      },
    });

    if (res.code !== 0) {
      throwFeishuError('刷新UserAccessToken失败', res.code, res.msg);
    }

    const data = res.data!;
    this.userAccessToken = data.access_token;
    this.userTokenExpireTime = Date.now() + ((data.expires_in || 7200) - 60) * 1000;
    if (data.refresh_token) {
      this.refreshToken = data.refresh_token;
      // 飞书可能轮换 refresh_token，重置其过期窗口（默认 7 天，避免被旧窗口误判过期）
      const rtSeconds = (data as any).refresh_expires_in || 604800;
      this.refreshTokenExpireTime = Date.now() + (rtSeconds - 60) * 1000;
    }

    // 刷新后持久化新的 token 到文件
    await saveToken({
      accessToken: this.userAccessToken,
      accessTokenExpireAt: this.userTokenExpireTime,
      refreshToken: this.refreshToken || '',
      refreshTokenExpireAt: this.refreshTokenExpireTime,
    });

    return {
      accessToken: data.access_token,
      expire: data.expires_in || 7200,
    };
  }

  /** 手动设置用户 token（供外部回填） */
  setUserAccessToken(token: string, expire: number): void {
    this.userAccessToken = token;
    this.userTokenExpireTime = expire;
    // 持久化 access_token 更新（保留已有的 refresh_token，fire-and-forget）
    if (this.refreshToken) {
      saveToken({
        accessToken: token,
        accessTokenExpireAt: expire,
        refreshToken: this.refreshToken,
        refreshTokenExpireAt: this.refreshTokenExpireTime,
      }).catch((err) => console.error('[FeishuBitable] 持久化 token 失败:', err));
    }
  }

  /** 清除用户 token */
  clearUserAccessToken(): void {
    this.userAccessToken = null;
    this.userTokenExpireTime = 0;
    this.refreshToken = null;
    this.refreshTokenExpireTime = 0;
    // 同时删除持久化文件（fire-and-forget）
    deleteToken().catch((err) => console.error('[FeishuBitable] 删除 token 文件失败:', err));
  }

  /** 实例中是否存有有效用户 token（供 webhook 等场景检查） */
  isUserAuthenticated(): boolean {
    return this.userAccessToken !== null && Date.now() < this.userTokenExpireTime;
  }

  /**
   * 确保用户 token 可用（供 webhook 调用）
   * - access_token 有效 → 直接返回 true
   * - 冷启动无缓存 → 从数据库恢复 token
   * - access_token 过期但 refresh_token 有效 → 自动刷新后返回 true
   * - 都无效 → 返回 false
   */
  async ensureAuth(): Promise<boolean> {
    if (this.isUserAuthenticated()) return true;

    // 冷启动兜底：内存缓存为空时从数据库恢复 token
    if (!this.userAccessToken && !this.refreshToken) {
      try {
        const stored = await reloadToken();
        if (stored) {
          if (Date.now() < stored.accessTokenExpireAt) {
            this.userAccessToken = stored.accessToken;
            this.userTokenExpireTime = stored.accessTokenExpireAt;
            this.refreshToken = stored.refreshToken;
            this.refreshTokenExpireTime = stored.refreshTokenExpireAt;
            console.log('[FeishuBitable] 冷启动：从数据库恢复了有效的 user token');
            return true;
          } else if (Date.now() < stored.refreshTokenExpireAt) {
            this.refreshToken = stored.refreshToken;
            this.refreshTokenExpireTime = stored.refreshTokenExpireAt;
            console.log('[FeishuBitable] 冷启动：从数据库恢复了 refresh_token，尝试刷新...');
          } else {
            console.log('[FeishuBitable] 冷启动：数据库中 token 已全部过期');
            return false;
          }
        } else {
          console.log('[FeishuBitable] 冷启动：数据库中无 token');
          return false;
        }
      } catch (err) {
        console.error('[FeishuBitable] 冷启动从数据库加载 token 失败:', err);
        return false;
      }
    }

    // access_token 过期，尝试用 refresh_token 刷新
    if (this.refreshToken && Date.now() < this.refreshTokenExpireTime) {
      try {
        console.log('[FeishuBitable] access_token 过期，尝试自动刷新...');
        await this.refreshUserAccessToken();
        console.log('[FeishuBitable] 自动刷新成功');
        return true;
      } catch (err) {
        console.error('[FeishuBitable] 自动刷新失败:', err);
      }
    }

    return false;
  }

  // ====== OAuth ======

  /**
   * 获取飞书 OAuth 授权 URL
   * @param state 可选：自定义 state，OAuth 回调时原样返回
   * @param redirectUri 可选：回调地址，不传则用环境变量 REDIRECT_URI 或自动推导
   */
  getOAuthUrl(state?: string, redirectUri?: string): string {
    const uri = redirectUri || process.env.REDIRECT_URI || 'http://localhost:3000/api/bitable/oauth/callback';
    const params = new URLSearchParams({
      client_id: this.appId,
      redirect_uri: uri,
      response_type: 'code',
      scope:
        'bitable:app bitable:app:readonly drive:drive drive:file docx:document docx:document:readonly sheets:spreadsheet sheets:spreadsheet:readonly contact:contact.base:readonly space:document:delete offline_access',
      state: state || '',
    });
    return `https://open.feishu.cn/open-apis/authen/v1/authorize?${params.toString()}`;
  }

  // ====== 请求辅助 ======

  /**
   * 构建 SDK 请求 options
   * @param userAccessToken 显式传入的用户 token（优先级高）
   *   若为 null/undefined，则回退到实例存储的 token
   */
  private sdkOptions(userAccessToken?: string | null) {
    const token = userAccessToken ?? (this.isUserAuthenticated() ? this.userAccessToken : null);
    if (token) {
      return withUserAccessToken(token) as any;
    }
    return {} as any;
  }

  // ====== 文件下载 ======

  /**
   * 获取当前有效的用户 access_token（供代理下载等场景使用）
   * 会尝试从数据库恢复（冷启动兜底）并自动刷新
   */
  async getValidAccessToken(): Promise<string | null> {
    if (this.isUserAuthenticated()) return this.userAccessToken;

    // 冷启动兜底
    if (!this.userAccessToken && !this.refreshToken) {
      try {
        const stored = await reloadToken();
        if (stored) {
          this.userAccessToken = stored.accessToken;
          this.userTokenExpireTime = stored.accessTokenExpireAt;
          this.refreshToken = stored.refreshToken;
          this.refreshTokenExpireTime = stored.refreshTokenExpireAt;
          if (Date.now() < stored.accessTokenExpireAt) return this.userAccessToken;
        }
      } catch { /* 继续尝试刷新 */ }
    }

    if (this.refreshToken && Date.now() < this.refreshTokenExpireTime) {
      try {
        await this.refreshUserAccessToken();
        return this.userAccessToken;
      } catch (err) {
        console.error('[FeishuBitable] getValidAccessToken 自动刷新失败:', err);
      }
    }
    return null;
  }

  /** 获取素材临时下载链接（24小时有效，支持高级权限表格） */
  async getTmpDownloadUrl(
    fileToken: string,
    tableId?: string,
    fieldId?: string,
    recordId?: string,
  ): Promise<string | null> {
    await this.ensureAuth();
    if (!this.isUserAuthenticated()) return null;

    // 高级权限表格：构建 extra 参数
    let extra: string | undefined;
    if (tableId && fieldId && recordId) {
      extra = JSON.stringify({
        bitablePerm: {
          tableId,
          attachments: { [fieldId]: { [recordId]: [fileToken] } },
        },
      });
    }

    const res = await this.client.drive.media.batchGetTmpDownloadUrl({
      params: {
        file_tokens: [fileToken],
        ...(extra ? { extra } : {}),
      },
    }, this.sdkOptions());

    if (res.code !== 0) {
      console.error(`[FeishuBitable] batchGetTmpDownloadUrl 失败 [${res.code}]:`, res.msg);
      return null;
    }

    // SDK 返回的是数组 [{file_token, tmp_download_url}, ...]
    const urls = res.data?.tmp_download_urls;
    if (!urls || !Array.isArray(urls)) return null;
    const match = urls.find((item) => item.file_token === fileToken);
    return match?.tmp_download_url ?? null;
  }

  // ====== Bitable API（全部支持 userAccessToken 参数） ======

  /**
   * 列出记录（带服务端缓存）
   * 缓存 key 形如 records:appToken:tableId:pageToken:pageSize，
   * 与 /api/bitable 路由、工作流执行器共用 lib/cache 的同一套缓存。
   * 排序已改为前端进行，服务端不再接收 sort 参数。
   */
  async listRecords(
    appToken: string,
    tableId: string,
    pageSize = 100,
    pageToken = '',
    userAccessToken?: string | null,
    force = false,
  ): Promise<ListRecordsData> {
    const cacheKeyStr = cacheKey('records', appToken, tableId, pageToken || '0', String(pageSize));
    if (force) cacheDelByPrefix(cacheKey('records', appToken, tableId));
    return withCache(cacheKeyStr, async () => {
      console.log(`[FeishuBitable] listRecords appToken=${appToken} tableId=${tableId} pageSize=${pageSize}`);

      const listParams: Record<string, unknown> = { page_size: pageSize, page_token: pageToken };

      const res = await this.client.bitable.appTableRecord.list({
        path: { app_token: appToken, table_id: tableId },
        params: listParams,
      }, this.sdkOptions(userAccessToken));

      if (res.code !== 0) {
        throwFeishuError('列出记录失败', res.code, res.msg);
      }

      const d = res.data!;
      const records: BitableRecord[] = (d.items || []).map((item) => ({
        record_id: item.record_id || '',
        fields: (item.fields || {}) as Record<string, unknown>,
        created_time: String(item.created_time || ''),
        updated_time: String(item.last_modified_time || ''),
      }));

      return {
        records,
        has_more: d.has_more || false,
        page_token: d.page_token || '',
        total: d.total || records.length,
      };
    }, TTL.RECORDS);
  }

  /** 读取单条记录（带服务端缓存，与 /api/bitable 路由共用 lib/cache） */
  async readRecord(
    appToken: string,
    tableId: string,
    recordId: string,
    userAccessToken?: string | null,
    force = false,
  ): Promise<BitableRecord> {
    const cacheKeyStr = cacheKey('record', appToken, tableId, recordId);
    if (force) cacheDel(cacheKeyStr);
    return withCache(cacheKeyStr, async () => {
      console.log(`[FeishuBitable] readRecord appToken=${appToken} tableId=${tableId} recordId=${recordId}`);

      const res = await this.client.bitable.appTableRecord.get({
        path: { app_token: appToken, table_id: tableId, record_id: recordId },
      }, this.sdkOptions(userAccessToken));

      if (res.code !== 0) {
        throwFeishuError('读取记录失败', res.code, res.msg);
      }

      const r = res.data?.record;
      return {
        record_id: r?.record_id || recordId,
        fields: (r?.fields || {}) as Record<string, unknown>,
        created_time: String(r?.created_time || ''),
        updated_time: String(r?.last_modified_time || ''),
      };
    }, TTL.RECORD);
  }

  async createRecord(
    appToken: string,
    tableId: string,
    fields: Record<string, unknown>,
    userAccessToken?: string | null,
  ): Promise<BitableRecord> {
    console.log('[FeishuBitable.createRecord] appToken=%s tableId=%s fields=%s',
      appToken, tableId, JSON.stringify(fields));

    const res = await this.client.bitable.appTableRecord.create({
      path: { app_token: appToken, table_id: tableId },
      data: { fields: fields as any },
    }, this.sdkOptions(userAccessToken));

    if (res.code !== 0) {
      throwFeishuError('创建记录失败', res.code, res.msg);
    }

    // 写操作后失效该表的记录缓存（多维表格页面与工作流节点共用 lib/cache）
    cacheDelByPrefix(cacheKey('records', appToken, tableId));

    const r = res.data?.record;
    return {
      record_id: r?.record_id || '',
      fields: (r?.fields || {}) as Record<string, unknown>,
      created_time: String(r?.created_time || ''),
      updated_time: String(r?.last_modified_time || ''),
    };
  }

  async updateRecord(
    appToken: string,
    tableId: string,
    recordId: string,
    fields: Record<string, unknown>,
    userAccessToken?: string | null,
  ): Promise<BitableRecord> {
    console.log('[FeishuBitable.updateRecord] appToken=%s tableId=%s recordId=%s fields=%s',
      appToken, tableId, recordId, JSON.stringify(fields));

    const res = await this.client.bitable.appTableRecord.update({
      path: { app_token: appToken, table_id: tableId, record_id: recordId },
      data: { fields: fields as any },
    }, this.sdkOptions(userAccessToken));

    if (res.code !== 0) {
      throwFeishuError('更新记录失败', res.code, res.msg);
    }

    // 写操作后失效该表的记录缓存与单条记录缓存（多维表格页面与工作流节点共用 lib/cache）
    cacheDelByPrefix(cacheKey('records', appToken, tableId));
    cacheDel(cacheKey('record', appToken, tableId, recordId));

    const r = res.data?.record;
    return {
      record_id: r?.record_id || recordId,
      fields: (r?.fields || {}) as Record<string, unknown>,
      created_time: String(r?.created_time || ''),
      updated_time: String(r?.last_modified_time || ''),
    };
  }

  async deleteRecord(
    appToken: string,
    tableId: string,
    recordId: string,
    userAccessToken?: string | null,
  ): Promise<string> {
    console.log('[FeishuBitable.deleteRecord] appToken=%s tableId=%s recordId=%s',
      appToken, tableId, recordId);

    const res = await this.client.bitable.appTableRecord.delete({
      path: { app_token: appToken, table_id: tableId, record_id: recordId },
    }, this.sdkOptions(userAccessToken));

    if (res.code !== 0) {
      throwFeishuError('删除记录失败', res.code, res.msg);
    }

    // 写操作后失效该表的记录缓存与单条记录缓存（多维表格页面与工作流节点共用 lib/cache）
    cacheDelByPrefix(cacheKey('records', appToken, tableId));
    cacheDel(cacheKey('record', appToken, tableId, recordId));

    return res.data?.record_id || recordId;
  }

  /**
   * 上传图片/文件到指定多维表格，返回可用于附件字段的 file_token
   * 使用 drive.media.uploadAll，parent_node 直接填多维表格的 app_token，
   * 这样文件会作为该云文档的素材，可直接写入附件字段 [{ file_token }]
   *
   * @param fileName   文件名
   * @param appToken   目标多维表格 app_token（作为云文档父节点）
   * @param dataUrl     base64 data URL（data:<mime>;base64,xxxx）或纯 base64 字符串
   */
  async uploadFileToBitable({
    fileName,
    appToken,
    dataUrl,
  }: {
    fileName: string;
    appToken: string;
    dataUrl: string;
  }): Promise<string> {
    await this.ensureAuth();
    if (!this.isUserAuthenticated()) {
      throw new Error('用户未授权，无法上传文件到多维表格');
    }

    const commaIdx = dataUrl.indexOf(',');
    const meta = commaIdx > -1 && dataUrl.slice(0, commaIdx).includes('base64')
      ? dataUrl.slice(0, commaIdx)
      : '';
    const base64 = commaIdx > -1 ? dataUrl.slice(commaIdx + 1) : dataUrl;
    const mimeMatch = meta.match(/data:([^;]+)/);
    const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
    const isImage = mime.startsWith('image/');
    const buffer = Buffer.from(base64, 'base64');

    const res: any = await this.client.drive.media.uploadAll(
      {
        data: {
          file_name: fileName,
          parent_type: isImage ? 'bitable_image' : 'bitable_file',
          parent_node: appToken,
          size: buffer.length,
          file: buffer,
        },
      },
      this.sdkOptions(),
    );

    const fileToken = res?.file_token ?? res?.data?.file_token;
    if (!fileToken) {
      throw new Error(
        `上传文件失败: 未返回 file_token (${JSON.stringify(res)}). 请确认对该多维表格有写入权限`,
      );
    }
    return fileToken;
  }

  async listTables(
    appToken: string,
    pageSize = 100,
    pageToken = '',
    userAccessToken?: string | null,
  ): Promise<ListTablesData> {
    console.log('[FeishuBitable.listTables] appToken=%s pageSize=%s pageToken=%s',
      appToken, pageSize, pageToken);

    const payload: any = {
      path: { app_token: appToken },
      params: { page_size: pageSize },
    };
    if (pageToken) {
      payload.params.page_token = pageToken;
    }

    const res = await this.client.bitable.appTable.list(
      payload,
      this.sdkOptions(userAccessToken),
    );

    if (res.code !== 0) {
      throwFeishuError('列出数据表失败', res.code, res.msg);
    }

    const d = res.data!;
    return {
      items: (d.items || []).map((t) => ({
        table_id: t.table_id || '',
        name: t.name || '',
        created_time: '',  // 飞书 appTable.list API 不返回，无法获取
        updated_time: '',  // 同上
      })),
      has_more: d.has_more || false,
      page_token: d.page_token || '',
    };
  }

  async createTable(
    appToken: string,
    name: string,
    fields: { name: string; type: FieldType }[],
    userAccessToken?: string | null,
  ): Promise<Table> {
    console.log('[FeishuBitable.createTable] appToken=%s name=%s fields=%s',
      appToken, name, JSON.stringify(fields));

    // 飞书 SDK 需要用数字类型，把字符串 FieldType 转回数字
    const REVERSE_FIELD_TYPE_MAP: Record<FieldType, number> = {
      text: 1,
      number: 2,
      single_select: 3,
      multi_select: 4,
      date: 5,
      checkbox: 7,
      person: 11,
      url: 15,
      file: 17,
      phone: 18,
      formula: 20,
      lookup: 21,
      created_time: 1001,
      created_by: 1002,
      updated_by: 1003,
      updated_time: 1004,
      email: 99,
    };

    const res = await this.client.bitable.appTable.create({
      path: { app_token: appToken },
      data: {
        table: {
          name,
          fields: fields.map((f) => ({
            field_name: f.name,
            type: REVERSE_FIELD_TYPE_MAP[f.type] || 1,
          })),
        },
      },
    } as any, this.sdkOptions(userAccessToken));

    if (res.code !== 0) {
      throwFeishuError('创建数据表失败', res.code, res.msg);
    }

    const now = new Date().toISOString();
    return {
      table_id: res.data?.table_id || '',
      name,
      fields: fields.map((f) => ({ field_id: '', name: f.name, type: f.type })),
      created_time: now,
      updated_time: now,
    };
  }

  async deleteTable(
    appToken: string,
    tableId: string,
    userAccessToken?: string | null,
  ): Promise<void> {
    console.log('[FeishuBitable.deleteTable] appToken=%s tableId=%s', appToken, tableId);

    const res = await this.client.bitable.appTable.delete({
      path: { app_token: appToken, table_id: tableId },
    }, this.sdkOptions(userAccessToken));

    if (res.code !== 0) {
      throwFeishuError('删除数据表失败', res.code, res.msg);
    }
  }

  /** 列出数据表的所有字段 */
  async listFields(
    appToken: string,
    tableId: string,
    pageSize = 100,
    pageToken = '',
    userAccessToken?: string | null,
  ): Promise<Field[]> {
    console.log('[FeishuBitable.listFields] appToken=%s tableId=%s pageSize=%s pageToken=%s',
      appToken, tableId, pageSize, pageToken);

    const payload: any = {
      path: { app_token: appToken, table_id: tableId },
      params: { page_size: pageSize },
    };
    if (pageToken) {
      payload.params.page_token = pageToken;
    }

    const res = await this.client.bitable.appTableField.list(
      payload,
      this.sdkOptions(userAccessToken),
    );

    if (res.code !== 0) {
      throwFeishuError('列出字段失败', res.code, res.msg);
    }

    const rawItems = res.data?.items || [];
    const mapped = rawItems.map((f) => ({
      field_id: f.field_id || '',
      name: f.field_name,
      type: FIELD_TYPE_MAP[f.type] || 'text',
      // 单选/多选选项：飞书 property.options 里用 name 承载选项文字（注意不是 text）
      options:
        f.property?.options?.map((o: { id?: string; name?: string; text?: string }) => ({
          id: o.id || '',
          text: o.name ?? o.text ?? '',
        })) || [],
    }));

    console.log('[FeishuBitable.listFields] count=%d | has_more=%s | total=%s',
      mapped.length, res.data?.has_more, res.data?.total);
    console.log('[FeishuBitable.listFields] fields=%s',
      JSON.stringify(mapped.map((f) => ({ id: f.field_id, name: f.name, type: f.type }))));
    return mapped;
  }

  // ====== Drive / App API ======

  /** 创建多维表格应用 */
  async createApp(
    name: string,
    folderToken?: string,
    userAccessToken?: string | null,
  ): Promise<App> {
    console.log('[FeishuBitable.createApp] name=%s folderToken=%s', name, folderToken);

    const res = await this.client.bitable.app.create({
      data: { name, folder_token: folderToken },
    }, this.sdkOptions(userAccessToken));

    if (res.code !== 0) {
      throwFeishuError('创建多维表格应用失败', res.code, res.msg);
    }

    const a = res.data?.app;
    return {
      app_token: a?.app_token || '',
      name: a?.name || name,
      url: '',
      folder_token: folderToken || '',
      create_time: new Date().toISOString(),
      update_time: new Date().toISOString(),
      creator_id: '',
      owner_id: '',
    };
  }

  /** 创建新版云文档 */
  async createDocx(
    title: string,
    folderToken?: string,
    userAccessToken?: string | null,
  ): Promise<App> {
    console.log('[FeishuBitable.createDocx] title=%s folderToken=%s', title, folderToken);

    const res = await this.client.docx.document.create({
      data: { title, folder_token: folderToken },
    }, this.sdkOptions(userAccessToken));

    if (res.code !== 0) {
      throwFeishuError('创建云文档失败', res.code, res.msg);
    }

    const doc = res.data?.document;
    return {
      app_token: doc?.document_id || '',
      name: doc?.title || title,
      url: '',
      folder_token: folderToken || '',
      create_time: new Date().toISOString(),
      update_time: new Date().toISOString(),
      creator_id: '',
      owner_id: '',
    };
  }

  /** 创建在线电子表格 */
  async createSheet(
    title: string,
    folderToken?: string,
    userAccessToken?: string | null,
  ): Promise<App> {
    console.log('[FeishuBitable.createSheet] title=%s folderToken=%s', title, folderToken);

    const res = await this.client.sheets.spreadsheet.create({
      data: { title, folder_token: folderToken },
    }, this.sdkOptions(userAccessToken));

    if (res.code !== 0) {
      throwFeishuError('创建电子表格失败', res.code, res.msg);
    }

    const ss = res.data?.spreadsheet;
    return {
      app_token: ss?.spreadsheet_token || '',
      name: ss?.title || title,
      url: ss?.url || '',
      folder_token: folderToken || '',
      create_time: new Date().toISOString(),
      update_time: new Date().toISOString(),
      creator_id: '',
      owner_id: '',
    };
  }

  /** 列出指定类型的云文件（drive.file.list 的泛化封装） */
  async listDriveFiles(
    fileType: DriveFileType,
    pageSize = 100,
    pageToken = '',
    folderToken = '',
    userAccessToken?: string | null,
  ): Promise<{ files: App[]; has_more: boolean; page_token: string }> {
    console.log('[FeishuBitable.listDriveFiles] type=%s pageSize=%s pageToken=%s folderToken=%s',
      fileType, pageSize, pageToken, folderToken);

    const params: Record<string, unknown> = {
      page_size: pageSize,
      page_token: pageToken,
    };
    if (folderToken) {
      params.folder_token = folderToken;
    }

    const res = await this.client.drive.file.list({
      params: params as any,
    }, this.sdkOptions(userAccessToken));

    if (res.code !== 0) {
      throwFeishuError('列出文件列表失败', res.code, res.msg);
    }

    const d = res.data!;
    const allFiles = d.files || [];
    
    // 打印所有文件类型，辅助排查
    const typeCounts: Record<string, number> = {};
    allFiles.forEach((f) => { typeCounts[f.type || '(null)'] = (typeCounts[f.type || '(null)'] || 0) + 1; });
    console.log('[FeishuBitable.listDriveFiles] 所有文件类型分布:', typeCounts);
    console.log('[FeishuBitable.listDriveFiles] 目标类型=%s 总数=%d', fileType, allFiles.length);
    
    const matched = allFiles.filter((file) => file.type === fileType);
    console.log('[FeishuBitable.listDriveFiles] 匹配数=%d', matched.length);

    const apps: App[] = matched.map((file) => ({
      app_token: file.token,
      name: file.name,
      url: file.url || '',
      folder_token: file.parent_token || '',
      create_time: (file as any).created_time
        ? new Date(Number((file as any).created_time) * 1000).toISOString()
        : '',
      update_time: (file as any).modified_time
        ? new Date(Number((file as any).modified_time) * 1000).toISOString()
        : '',
      owner_id: (file as any).owner_id || '',
      // 飞书 drive.file.list API 不返回 creator_id，用 owner_id 作为兜底
      creator_id: (file as any).creator_id || (file as any).owner_id || '',
    }));

    // 批量获取创建人名片
    const creatorIds = [...new Set(apps.map((a) => a.creator_id).filter(Boolean))];
    console.log('[FeishuBitable.listDriveFiles] creatorIds:', creatorIds);
    if (creatorIds.length > 0) {
      try {
        const profileMap = await this.getUserNamesBatch(creatorIds, userAccessToken);
        for (const app of apps) {
          if (app.creator_id && profileMap[app.creator_id]) {
            const p = profileMap[app.creator_id];
            app.creator_name = p.name;
            app.creator_profile = p;
          }
        }
      } catch (err) {
        console.warn('[FeishuBitable.listDriveFiles] 获取创建人名片失败:', err);
      }
    }

    return {
      files: apps,
      has_more: d.has_more || false,
      page_token: (d as any).page_token || '',
    };
  }

  /** 获取 tenant_access_token（缓存复用） */
  private tenantAccessToken: string | null = null;
  private tenantTokenExpireTime = 0;

  private async getTenantAccessToken(): Promise<string | null> {
    if (this.tenantAccessToken && Date.now() < this.tenantTokenExpireTime - 60000) {
      return this.tenantAccessToken;
    }
    try {
      const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ app_id: this.appId, app_secret: process.env.APP_SECRET || '' }),
      });
      const json = await res.json();
      if (json.code === 0 && json.tenant_access_token) {
        this.tenantAccessToken = json.tenant_access_token;
        this.tenantTokenExpireTime = Date.now() + ((json.expire || 7200) - 600) * 1000;
        return this.tenantAccessToken;
      }
      console.warn('[FeishuBitable.getTenantAccessToken] 获取失败:', json.code, json.msg);
    } catch (err) {
      console.warn('[FeishuBitable.getTenantAccessToken] 异常:', err);
    }
    return null;
  }

  /** 从 API 返回的用户数据提取 UserProfile */
  private extractUserProfile(user: Record<string, unknown>, idType: string): { key: string; profile: UserProfile } | null {
    const uid = user[idType] as string;
    if (!uid) return null;
    const profile: UserProfile = {
      open_id: uid,
      name: (user.name || user.email || user.mobile || uid) as string,
      avatar_url: user.avatar_url as string | undefined,
      email: user.email as string | undefined,
      mobile: user.mobile as string | undefined,
      en_name: user.en_name as string | undefined,
      nickname: user.nickname as string | undefined,
      description: user.description as string | undefined,
    };
    return { key: uid, profile };
  }

  /** 逐用户查询详情（单条 API，用于批量API不可用时的回退） */
  private async getUserProfilesOneByOne(
    userIds: string[],
    token: string,
    idType: string,
  ): Promise<Record<string, UserProfile>> {
    const profileMap: Record<string, UserProfile> = {};
    for (const uid of userIds) {
      try {
        const res = await fetch(`https://open.feishu.cn/open-apis/contact/v3/users/${uid}?user_id_type=${idType}`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${token}` },
        });
        const json = await res.json();
        if (json.code === 0 && json.data?.user) {
          const entry = this.extractUserProfile(json.data.user as Record<string, unknown>, idType);
          if (entry) profileMap[entry.key] = entry.profile;
        }
      } catch (err) {
        // 单条失败继续
      }
    }
    return profileMap;
  }

  /** 批量获取用户名片（调用通讯录 API，自动尝试 open_id / union_id / user token / tenant token） */
  async getUserNamesBatch(
    userIds: string[],
    userAccessToken?: string | null,
  ): Promise<Record<string, UserProfile>> {
    if (userIds.length === 0) return {};

    const userToken = userAccessToken ?? (this.isUserAuthenticated() ? this.userAccessToken : null);

    const batchGet = async (
      ids: string[],
      idType: string,
      token: string,
      label: string,
    ): Promise<Record<string, UserProfile>> => {
      const profileMap: Record<string, UserProfile> = {};
      const batchSize = 50;
      for (let i = 0; i < ids.length; i += batchSize) {
        const batch = ids.slice(i, i + batchSize);
        try {
          const url = `https://open.feishu.cn/open-apis/contact/v3/users/batch`;
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json; charset=utf-8',
            },
            body: JSON.stringify({ user_ids: batch, user_id_type: idType }),
          });
          const json = await res.json();
          console.log(`[FeishuBitable.getUserNamesBatch] ${idType}(${label}) 响应:`, JSON.stringify({ code: json.code, msg: json.msg, itemCount: json.data?.items?.length }));
          if (json.code === 0 && json.data?.items) {
            for (const user of json.data.items) {
              const entry = this.extractUserProfile(user as Record<string, unknown>, idType);
              if (entry) profileMap[entry.key] = entry.profile;
            }
          } else {
            console.warn(`[FeishuBitable.getUserNamesBatch] ${idType}(${label}) API返回非0:`, json.code, json.msg);
          }
        } catch (err) {
          console.warn(`[FeishuBitable.getUserNamesBatch] ${idType}(${label}) batch ${i} 失败:`, err);
        }
      }
      return profileMap;
    };

    let profileMap: Record<string, UserProfile> = {};

    // 1. 优先用 user_access_token + open_id
    if (userToken) {
      profileMap = await batchGet(userIds, 'open_id', userToken, 'user');
      let unresolved = userIds.filter((id) => !profileMap[id]);
      if (unresolved.length > 0) {
        console.log('[FeishuBitable.getUserNamesBatch] user_token未解析的ID (尝试union_id):', unresolved);
        const unionMap = await batchGet(unresolved, 'union_id', userToken, 'user');
        Object.assign(profileMap, unionMap);
      }

      unresolved = userIds.filter((id) => !profileMap[id]);
      if (unresolved.length === userIds.length) {
        console.log('[FeishuBitable.getUserNamesBatch] user_token完全未解析，回退到tenant_token');
      }
    }

    // 2. 用 tenant_access_token 补全未解析的
    const stillUnresolved = userIds.filter((id) => !profileMap[id]);
    if (stillUnresolved.length > 0) {
      const tt = await this.getTenantAccessToken();
      if (tt) {
        let tenantMap = await batchGet(stillUnresolved, 'open_id', tt, 'tenant');
        let left = stillUnresolved.filter((id) => !tenantMap[id]);
        if (left.length > 0) {
          console.log('[FeishuBitable.getUserNamesBatch] tenant_token未解析的ID (尝试union_id):', left);
          const unionMap = await batchGet(left, 'union_id', tt, 'tenant');
          Object.assign(tenantMap, unionMap);
        }

        // 3. 逐条API兜底
        left = stillUnresolved.filter((id) => !tenantMap[id]);
        if (left.length > 0) {
          console.log('[FeishuBitable.getUserNamesBatch] batch失败，改用逐条API:', left);
          const oneMap = await this.getUserProfilesOneByOne(left, tt, 'open_id');
          Object.assign(tenantMap, oneMap);
          const stillLeft = left.filter((id) => !tenantMap[id]);
          if (stillLeft.length > 0) {
            const oneUnionMap = await this.getUserProfilesOneByOne(stillLeft, tt, 'union_id');
            Object.assign(tenantMap, oneUnionMap);
          }
        }

        Object.assign(profileMap, tenantMap);
      }
    }

    if (userIds.some((id) => !profileMap[id])) {
      console.warn('[FeishuBitable.getUserNamesBatch] 仍有ID未解析:', userIds.filter((id) => !profileMap[id]));
    }

    return profileMap;
  }

  /** 列出所有多维表格（委托给 listDriveFiles） */
  async listApps(
    pageSize = 100,
    pageToken = '',
    folderToken = '',
    userAccessToken?: string | null,
  ): Promise<{ files: App[]; has_more: boolean; page_token: string }> {
    return this.listDriveFiles('bitable', pageSize, pageToken, folderToken, userAccessToken);
  }

  /** 列出所有云文档 */
  async listDocs(
    pageSize = 100,
    pageToken = '',
    folderToken = '',
    userAccessToken?: string | null,
  ): Promise<{ files: App[]; has_more: boolean; page_token: string }> {
    return this.listDriveFiles('docx', pageSize, pageToken, folderToken, userAccessToken);
  }

  /** 列出所有在线表格 */
  async listSheets(
    pageSize = 100,
    pageToken = '',
    folderToken = '',
    userAccessToken?: string | null,
  ): Promise<{ files: App[]; has_more: boolean; page_token: string }> {
    return this.listDriveFiles('sheet', pageSize, pageToken, folderToken, userAccessToken);
  }

  /** 删除云文件（支持 doc/docx/sheet/bitable 等类型） */
  async deleteFile(
    fileToken: string,
    fileType: string,
    userAccessToken?: string | null,
  ): Promise<void> {
    console.log('[FeishuBitable.deleteFile] fileToken=%s type=%s', fileToken, fileType);

    const res = await this.client.drive.file.delete({
      path: { file_token: fileToken },
      params: { type: fileType as any },
    }, this.sdkOptions(userAccessToken));

    if (res.code !== 0) {
      throwFeishuError('删除文件失败', res.code, res.msg);
    }
  }

  // ====== IM 消息 API ======

  /**
   * 发送飞书文本消息
   * @param receiveIdType 接收者类型：open_id / user_id / union_id / email / chat_id
   * @param receiveId 接收者 ID
   * @param content 文本内容
   * @param userAccessToken 可选用户 token
   */
  async sendImTextMessage(
    receiveIdType: 'email' | 'open_id' | 'user_id' | 'union_id' | 'chat_id',
    receiveId: string,
    content: string,
    userAccessToken?: string | null,
  ): Promise<{ messageId: string }> {
    console.log('[FeishuBitable.sendImTextMessage] receiveIdType=%s receiveId=%s', receiveIdType, receiveId);

    const res = await this.client.im.message.create({
      params: { receive_id_type: receiveIdType },
      data: {
        receive_id: receiveId,
        msg_type: 'text',
        content: JSON.stringify({ text: content }),
      },
    }, this.sdkOptions(userAccessToken));

    if (res.code !== 0) {
      throwFeishuError('发送文本消息失败', res.code, res.msg);
    }

    return { messageId: res.data?.message_id || '' };
  }

  /**
   * 发送飞书卡片消息
   * @param receiveIdType 接收者类型
   * @param receiveId 接收者 ID
   * @param cardJson 卡片 JSON（飞书卡片格式）
   * @param userAccessToken 可选用户 token
   */
  async sendImCardMessage(
    receiveIdType: 'email' | 'open_id' | 'user_id' | 'union_id' | 'chat_id',
    receiveId: string,
    cardJson: string,
    userAccessToken?: string | null,
  ): Promise<{ messageId: string }> {
    console.log('[FeishuBitable.sendImCardMessage] receiveIdType=%s receiveId=%s', receiveIdType, receiveId);

    let cardData: unknown;
    try {
      cardData = JSON.parse(cardJson);
    } catch {
      throw new Error('卡片 JSON 格式无效');
    }

    const res = await this.client.im.message.create({
      params: { receive_id_type: receiveIdType },
      data: {
        receive_id: receiveId,
        msg_type: 'interactive',
        content: JSON.stringify(cardData),
      },
    }, this.sdkOptions(userAccessToken));

    if (res.code !== 0) {
      throwFeishuError('发送卡片消息失败', res.code, res.msg);
    }

    return { messageId: res.data?.message_id || '' };
  }

  /**
   * 按筛选条件过滤记录（返回匹配的第一条记录 ID）
   * 用于 update_record / delete_record 等需要定位记录的操作
   */
  async findRecordByFilters(
    appToken: string,
    tableId: string,
    filters: Array<{ fieldName: string; operator: string; value: string }>,
    userAccessToken?: string | null,
  ): Promise<string | null> {
    const data = await this.listRecords(appToken, tableId, 100, '', userAccessToken);
    const records = data.records || [];

    for (const record of records) {
      let allMatch = true;
      for (const filter of filters) {
        const fieldValue = String(record.fields[filter.fieldName] ?? '');
        switch (filter.operator) {
          case 'eq':       if (fieldValue !== filter.value) allMatch = false; break;
          case 'ne':       if (fieldValue === filter.value) allMatch = false; break;
          case 'contains': if (!fieldValue.includes(filter.value)) allMatch = false; break;
          case 'gt':       if (Number(fieldValue) <= Number(filter.value)) allMatch = false; break;
          case 'lt':       if (Number(fieldValue) >= Number(filter.value)) allMatch = false; break;
          case 'gte':      if (Number(fieldValue) < Number(filter.value)) allMatch = false; break;
          case 'lte':      if (Number(fieldValue) > Number(filter.value)) allMatch = false; break;
        }
        if (!allMatch) break;
      }
      if (allMatch) return record.record_id;
    }
    return null;
  }
}

// ====== 单例导出 ======

export const bitableService = new FeishuBitable();

export type { BitableRecord, App, FieldType };
