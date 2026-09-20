/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  transpilePackages: ['@awning/api', '@awning/auth', '@awning/db', '@awning/spec', '@awning/tenancy', '@awning/ai', '@awning/integrations'],
  poweredByHeader: false,
  serverExternalPackages: ['@prisma/client', 'ioredis', 'better-auth', 'sharp', 'nodemailer'],
  eslint: { ignoreDuringBuilds: true }, // eslint.config.js at the root is authoritative
  webpack(config, { isServer }) {
    // Our source uses NodeNext-style ".js" specifiers pointing at ".ts" files.
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'], '.mjs': ['.mts', '.mjs'] }
    // serverExternalPackages does not reach a native module imported through a
    // TRANSPILED workspace package, so sharp gets bundled and its platform binary
    // cannot be resolved. Externalise it explicitly.
    if (isServer) config.externals = [...(config.externals ?? []), 'sharp', 'nodemailer']
    return config
  },
}
