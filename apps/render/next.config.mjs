/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source; there is no build step between them.
  transpilePackages: ['@awning/ui-blocks', '@awning/spec', '@awning/tenancy', '@awning/db'],
  poweredByHeader: false,
  // One lint config for the repo (eslint.config.js at the root, run by `pnpm lint` and
  // by CI). Next's build-time lint would apply a second, different rule set.
  eslint: { ignoreDuringBuilds: true },
  serverExternalPackages: ['@prisma/client', 'ioredis'],
  webpack(config) {
    // Our source uses NodeNext-style ".js" specifiers that point at ".ts" files.
    // Node and tsx resolve those natively; webpack needs to be told.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    }
    return config
  },
}
