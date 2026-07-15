import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // sharp 是原生二进制包，交由 Node 运行时直接加载，
  // 不让 webpack / Turbopack 打包（否则 import.meta.url 指向虚拟 chunk
  // 路径，运行时 require('sharp') 解析失败，导致 webp 转换静默回退）。
  serverExternalPackages: ['sharp'],
};

export default nextConfig;
