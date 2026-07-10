/** @type {import('next').NextConfig} */

// Parked domains that are allowed to frame moshcoding.com (Porkbun masked/
// frameset forwarding, e.g. moshcode.sh). Space-separated origins in the
// FRAME_ANCESTORS env; moshcode.sh is allowed by default. 'self' lets the app
// frame itself. Nothing else can frame it (anti-clickjacking), but these can.
const PARKED = (process.env.FRAME_ANCESTORS || "https://moshcode.sh")
  .split(/\s+/)
  .filter(Boolean);
const frameAncestors = ["'self'", ...PARKED].join(" ");

const nextConfig = {
  reactStrictMode: true,
  // brand assets are large PNGs served straight from /public
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: `frame-ancestors ${frameAncestors}` },
        ],
      },
    ];
  },
};

export default nextConfig;
