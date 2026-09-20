/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  transpilePackages: ['@awning/api', '@awning/auth', '@awning/db', '@awning/spec', '@awning/tenancy', '@awning/ai'],
  poweredByHeader: false,
  serverExternalPackages: ['@prisma/client', 'ioredis', 'better-auth'],
  eslint: { ignoreDuringBuilds: true }, // eslint.config.js at the root is authoritative
  webpack(config) {
    // Our source uses NodeNext-style ".js" specifiers pointing at ".ts" files.
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'], '.mjs': ['.mts', '.mjs'] }
    return config
  },
}
