// Tiny shared runner for the regression tests: labelled PASS/FAIL lines and a summary exit code.
export function suite(title) {
  const results = []; let current = Promise.resolve();
  const t = (name, fn) => { current = current.then(async () => { try { await fn(); results.push(true); console.log("PASS", name); } catch (e) { results.push(false); console.log("FAIL", name, "-", String(e.message).split("\n")[0].slice(0, 220)); } }); };
  const done = async () => { await current; const p = results.filter(Boolean).length; console.log(`\n${title}: ${p} passed, ${results.length - p} failed`); process.exit(results.every(Boolean) ? 0 : 1); };
  return { t, done };
}
