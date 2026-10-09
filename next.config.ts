import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['@electric-sql/pglite'],
  // Pièces jointes (photos, documents) jusqu'à 10 Mo, plus la marge multipart.
  experimental: { serverActions: { bodySizeLimit: '11mb' } },
};

export default nextConfig;
