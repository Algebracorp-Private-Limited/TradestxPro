// The XCHART_SAMPLE_ROOT override only exists for the SDK's own integration test (which resolves
// next/react from the repository); a normal app needs no configuration.
const root = process.env.XCHART_SAMPLE_ROOT;
export default root ? { turbopack: { root } } : {};
