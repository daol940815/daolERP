/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // xlsx(SheetJS)는 webpack 번들링 시 일부 시트 파싱이 깨지는 알려진 이슈가 있어,
  // 서버에서 node_modules의 원본을 그대로 require 하도록 외부 패키지로 유지한다.
  experimental: {
    serverComponentsExternalPackages: ["xlsx"],
  },
};

module.exports = nextConfig;
