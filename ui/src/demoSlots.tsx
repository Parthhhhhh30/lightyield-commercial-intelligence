// Demo-only UI slots. In the operational build these render nothing. The public demo build (vite.demo.config.ts) replaces this module with ./demo/DemoChrome.tsx,
// so no demo code, fixture or browser-local adapter is bundled into the operational application.
/* eslint-disable @typescript-eslint/no-unused-vars */
export const DemoBanner = () => null;
export const DemoGuide = () => null;
export const ResetDemo = () => null;
export const DemoSource = (_p: { run?: { source_id: string; source_text: string }; company?: { name: string; domain: string | null } }) => null;
