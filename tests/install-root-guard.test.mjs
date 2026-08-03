// public/install.sh is what `curl -fsSL https://moshcoding.com/install.sh | sh`
// actually runs. Every path in it comes from $HOME, so running it under sudo
// installs into /root/.moshcode with the wrapper at /root/.local/bin — mode
// 0700. link_system_bin then points /usr/local/bin/moshcode at that wrapper,
// which is the worst of both worlds: `moshcode` resolves on PATH for every
// user and executes for none. The install still prints "Install complete", so
// the first sign of trouble is `permission denied` on a later, unrelated
// command.
//
// These tests run the real script with `id` shadowed on PATH, so its root
// branch is exercised without root. The refusal must land before any work.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const INSTALL_SH = fileURLToPath(new URL("../public/install.sh", import.meta.url));
const scratch = [];

/** A PATH dir where `id -u` reports `uid`; curl/mise are tripwires. */
function fakeBin(uid) {
  const dir = mkdtempSync(join(tmpdir(), "moshcoding-guard-"));
  scratch.push(dir);
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "id"), `#!/bin/sh\n[ "$1" = "-u" ] && echo ${uid} && exit 0\nexec /usr/bin/id "$@"\n`);
  for (const tool of ["curl", "mise"]) {
    writeFileSync(join(bin, tool), `#!/bin/sh\necho "REACHED_${tool.toUpperCase()}" >&2\nexit 99\n`);
  }
  for (const f of ["id", "curl", "mise"]) chmodSync(join(bin, f), 0o755);
  return bin;
}

function runInstall(uid, env = {}) {
  const bin = fakeBin(uid);
  const home = mkdtempSync(join(tmpdir(), "moshcoding-home-"));
  scratch.push(home);
  try {
    return {
      code: 0,
      output: execFileSync("sh", [INSTALL_SH, "install"], {
        env: { PATH: `${bin}:${process.env.PATH}`, HOME: home, NO_COLOR: "1", ...env },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    };
  } catch (error) {
    return { code: error.status, output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

test("a sudo install is refused, and refused before anything happens", () => {
  const { code, output } = runInstall(0, { SUDO_USER: "anthony" });

  assert.notEqual(code, 0, "a sudo install must not report success");
  assert.match(output, /don't install moshcode with sudo/);
  // detect_os is the very first step of run_install. If its line appears, the
  // guard ran too late to be a guard.
  assert.doesNotMatch(output, /✓ OS:/);
  assert.doesNotMatch(output, /REACHED_CURL|REACHED_MISE/);
  assert.doesNotMatch(output, /Install complete/);
});

test("the refusal names the locked-out user and both ways forward", () => {
  const { output } = runInstall(0, { SUDO_USER: "anthony" });

  assert.match(output, /anthony/, "it should name the user who would be locked out");
  assert.match(output, /curl -fsSL https:\/\/moshcoding\.com\/install\.sh \| sh/);
  assert.match(output, /MOSHCODE_ALLOW_ROOT=1/);
});

test("a bare root shell still installs — only sudo-from-a-user is refused", () => {
  // Containers, CI images and root-only VPS boxes have no SUDO_USER. Refusing
  // there would break a legitimate install for no reason.
  const { output } = runInstall(0);

  assert.doesNotMatch(output, /don't install moshcode with sudo/);
  assert.match(output, /✓ OS:/, "it should get past the guard and start work");
});

test("MOSHCODE_ALLOW_ROOT overrides the refusal", () => {
  const { output } = runInstall(0, { SUDO_USER: "anthony", MOSHCODE_ALLOW_ROOT: "1" });

  assert.doesNotMatch(output, /don't install moshcode with sudo/);
  assert.match(output, /installing as root/);
  assert.match(output, /✓ OS:/);
});

test("a normal user is never affected, even with SUDO_USER set", () => {
  // A plain shell inherits SUDO_USER after any earlier sudo call, so the uid
  // check has to be the thing that decides.
  const { output } = runInstall(1000, { SUDO_USER: "anthony" });

  assert.doesNotMatch(output, /don't install moshcode with sudo/);
  assert.match(output, /✓ OS:/);
});

test("remove is deliberately left unguarded", () => {
  // Cleaning up an existing root install is the one case where running this
  // as root is the right thing to do.
  const source = readFileSync(INSTALL_SH, "utf8");
  const runRemove = source.slice(source.indexOf("run_remove()"), source.indexOf("run_install()"));

  assert.doesNotMatch(runRemove, /check_not_sudo/);
});

test("the sudo trap is documented in the header, not only in the error", () => {
  const source = readFileSync(INSTALL_SH, "utf8");
  const header = source.slice(0, source.indexOf("set -eu"));

  assert.match(header, /MOSHCODE_ALLOW_ROOT/);
  assert.match(header, /sudo/);
});

test.after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});
