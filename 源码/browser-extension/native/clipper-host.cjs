"use strict";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// ../../shared/private-rpc.cjs
var require_private_rpc = __commonJS({
  "../../shared/private-rpc.cjs"(exports2, module2) {
    "use strict";
    var fs2 = require("node:fs/promises");
    var constants = require("node:fs").constants;
    var path2 = require("node:path");
    var os2 = require("node:os");
    var net = require("node:net");
    var crypto = require("node:crypto");
    var FORMAT = "mengcang-recall-rpc-v1";
    var MAX_FRAME = 2 * 1024 * 1024;
    var uid = () => typeof process.getuid === "function" ? process.getuid() : null;
    var object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
    function failure(code, message) {
      return Object.assign(new Error(message), { code });
    }
    function serviceName(service) {
      if (typeof service !== "string" || !/^[a-z][a-z0-9-]{0,30}$/.test(service)) throw failure("INVALID_SERVICE", "\u65E0\u6548\u7684\u672C\u673A\u670D\u52A1\u540D\u79F0");
      return service;
    }
    function paths(directory, service) {
      serviceName(service);
      if (typeof directory !== "string" || !path2.isAbsolute(directory)) throw failure("INVALID_DIRECTORY", "\u672C\u673A\u6865\u63A5\u76EE\u5F55\u5FC5\u987B\u662F\u7EDD\u5BF9\u8DEF\u5F84");
      directory = path2.resolve(directory);
      const suffix = crypto.createHash("sha256").update(directory + "\0" + service).digest("hex").slice(0, 20);
      const socketDirectory = path2.join(os2.tmpdir().startsWith("/var/") ? "/private/tmp" : "/tmp", `mcr-${uid() ?? "user"}-${suffix}`);
      return { directory, endpoint: path2.join(directory, `${service}.json`), lock: path2.join(directory, `${service}.lock`), socketDirectory, socketPath: path2.join(socketDirectory, "rpc.sock") };
    }
    function assertPrivate(stat, kind) {
      if (stat.isSymbolicLink() || uid() !== null && stat.uid !== uid() || stat.mode & 63) throw failure("UNSAFE_ENDPOINT", `${kind}\u7684\u6240\u6709\u8005\u6216\u6743\u9650\u4E0D\u5B89\u5168`);
    }
    async function privateDirectory(directory) {
      await fs2.mkdir(directory, { recursive: true, mode: 448 });
      const stat = await fs2.lstat(directory);
      assertPrivate(stat, "\u672C\u673A\u6865\u63A5\u76EE\u5F55");
      if (!stat.isDirectory()) throw failure("UNSAFE_ENDPOINT", "\u672C\u673A\u6865\u63A5\u76EE\u5F55\u4E0D\u53EF\u7528");
    }
    async function readPrivateJson(file) {
      const handle = await fs2.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        assertPrivate(stat, "\u672C\u673A\u6865\u63A5\u6587\u4EF6");
        if (!stat.isFile() || stat.size > 8192) throw failure("UNSAFE_ENDPOINT", "\u672C\u673A\u6865\u63A5\u6587\u4EF6\u65E0\u6548");
        return JSON.parse(await handle.readFile("utf8"));
      } finally {
        await handle.close();
      }
    }
    async function atomicJson(file, value) {
      const temp = `${file}.${crypto.randomUUID()}.tmp`;
      const handle = await fs2.open(temp, "wx", 384);
      try {
        await handle.writeFile(JSON.stringify(value));
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await fs2.rename(temp, file);
      } catch (error) {
        await fs2.rm(temp, { force: true });
        throw error;
      }
    }
    function alive(pid) {
      if (!Number.isSafeInteger(pid) || pid < 1) return false;
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        return error.code === "EPERM";
      }
    }
    async function acquireLock(p, nonce) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const handle = await fs2.open(p.lock, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 384);
          try {
            await handle.writeFile(JSON.stringify({ pid: process.pid, nonce }));
          } finally {
            await handle.close();
          }
          return;
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
          let previous;
          try {
            previous = await readPrivateJson(p.lock);
          } catch {
            throw failure("SERVICE_BUSY", "\u672C\u673A\u670D\u52A1\u6B63\u5728\u542F\u52A8\u6216\u9501\u6587\u4EF6\u4E0D\u53EF\u7528");
          }
          if (alive(previous.pid)) throw failure("SERVICE_BUSY", "\u672C\u673A\u670D\u52A1\u5DF2\u7ECF\u8FD0\u884C");
          await fs2.unlink(p.lock);
        }
      }
      throw failure("SERVICE_BUSY", "\u672C\u673A\u670D\u52A1\u9501\u5B9A\u5931\u8D25");
    }
    function authenticated(received, expected) {
      return typeof received === "string" && /^[0-9a-f]{64}$/.test(received) && crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
    }
    function wireError(error) {
      const known = typeof error?.code === "string" && /^[A-Z0-9_-]{1,64}$/.test(error.code);
      return { code: known ? error.code : "REQUEST_FAILED", message: typeof error?.message === "string" ? error.message.slice(0, 1e3) : "\u672C\u673A\u8BF7\u6C42\u672A\u5B8C\u6210" };
    }
    async function startPrivateServer({ directory, service, handlers, socketTimeoutMs = 15e3 }) {
      const p = paths(directory, service);
      if (!object(handlers) || !Object.keys(handlers).length || Object.entries(handlers).some(([name, fn]) => !/^[a-zA-Z][a-zA-Z0-9]{0,60}$/.test(name) || typeof fn !== "function")) throw failure("INVALID_HANDLERS", "\u672C\u673A\u670D\u52A1\u65B9\u6CD5\u65E0\u6548");
      await privateDirectory(p.directory);
      await privateDirectory(p.socketDirectory);
      const token = crypto.randomBytes(32).toString("hex");
      const nonce = crypto.randomUUID();
      await acquireLock(p, nonce);
      const connections = /* @__PURE__ */ new Set(), pending = /* @__PURE__ */ new Set();
      let closing = false;
      const server = net.createServer((socket) => {
        connections.add(socket);
        let buffer = Buffer.alloc(0), accepted = false;
        socket.on("error", () => {
        });
        socket.on("close", () => connections.delete(socket));
        socket.setTimeout(socketTimeoutMs, () => socket.destroy());
        socket.on("data", (chunk) => {
          if (accepted) {
            socket.destroy();
            return;
          }
          buffer = Buffer.concat([buffer, chunk]);
          if (buffer.length > MAX_FRAME) {
            socket.destroy();
            return;
          }
          const newline = buffer.indexOf(10);
          if (newline < 0) return;
          accepted = true;
          if (buffer.subarray(newline + 1).length) {
            socket.destroy();
            return;
          }
          const run = (async () => {
            let request, response;
            try {
              request = JSON.parse(buffer.subarray(0, newline).toString("utf8"));
              if (!object(request) || request.format !== FORMAT || typeof request.id !== "string" || request.id.length > 100) throw failure("INVALID_REQUEST", "\u65E0\u6548\u7684\u672C\u673A\u8BF7\u6C42");
              if (!authenticated(request.token, token)) throw failure("UNAUTHORIZED", "\u672C\u673A\u8FDE\u63A5\u672A\u901A\u8FC7\u8BA4\u8BC1");
              if (closing) throw failure("SERVICE_CLOSING", "\u672C\u673A\u670D\u52A1\u6B63\u5728\u5173\u95ED");
              if (typeof request.method !== "string" || !Object.hasOwn(handlers, request.method)) throw failure("METHOD_NOT_FOUND", "\u6B64\u672C\u673A\u64CD\u4F5C\u4E0D\u53D7\u652F\u6301");
              response = { id: request.id, ok: true, result: await handlers[request.method](request.params ?? {}) };
            } catch (error) {
              response = { id: typeof request?.id === "string" ? request.id : null, ok: false, error: wireError(error) };
            }
            const serialized = JSON.stringify(response) + "\n";
            if (Buffer.byteLength(serialized) > MAX_FRAME) socket.end(JSON.stringify({ id: response.id, ok: false, error: { code: "RESPONSE_TOO_LARGE", message: "\u672C\u673A\u54CD\u5E94\u8FC7\u5927" } }) + "\n");
            else if (!socket.destroyed) socket.end(serialized);
          })();
          pending.add(run);
          run.finally(() => pending.delete(run)).catch(() => socket.destroy());
        });
      });
      try {
        try {
          const stat = await fs2.lstat(p.socketPath);
          assertPrivate(stat, "\u672C\u673A\u8FDE\u63A5");
          if (!stat.isSocket()) throw failure("UNSAFE_ENDPOINT", "\u672C\u673A\u8FDE\u63A5\u8DEF\u5F84\u4E0D\u53EF\u7528");
          await fs2.unlink(p.socketPath);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        await new Promise((resolve, reject) => {
          server.once("error", reject);
          server.listen(p.socketPath, () => {
            server.removeListener("error", reject);
            resolve();
          });
        });
        await fs2.chmod(p.socketPath, 384);
        await atomicJson(p.endpoint, { format: FORMAT, service, socketPath: p.socketPath, pid: process.pid, token, nonce });
      } catch (error) {
        server.close();
        await fs2.rm(p.lock, { force: true });
        throw error;
      }
      let closePromise;
      return {
        close() {
          if (closePromise) return closePromise;
          closing = true;
          closePromise = (async () => {
            const closed = new Promise((resolve) => server.close(resolve));
            await Promise.allSettled([...pending]);
            for (const socket of connections) socket.destroy();
            await closed;
            try {
              const current = await readPrivateJson(p.endpoint);
              if (current.nonce === nonce) await fs2.unlink(p.endpoint);
            } catch {
            }
            await fs2.rm(p.socketPath, { force: true });
            try {
              const current = await readPrivateJson(p.lock);
              if (current.nonce === nonce) await fs2.unlink(p.lock);
            } catch {
            }
          })();
          return closePromise;
        }
      };
    }
    async function callPrivate({ directory, service, method, params = {}, timeoutMs = 12e3 }) {
      const p = paths(directory, service);
      const dirStat = await fs2.lstat(p.directory).catch(() => {
        throw failure("SERVICE_UNAVAILABLE", "\u672C\u673A\u670D\u52A1\u5C1A\u672A\u542F\u52A8");
      });
      assertPrivate(dirStat, "\u672C\u673A\u6865\u63A5\u76EE\u5F55");
      let endpoint;
      try {
        endpoint = await readPrivateJson(p.endpoint);
      } catch (error) {
        if (error.code === "ENOENT") throw failure("SERVICE_UNAVAILABLE", "\u672C\u673A\u670D\u52A1\u5C1A\u672A\u542F\u52A8");
        throw error;
      }
      if (!object(endpoint) || endpoint.format !== FORMAT || endpoint.service !== service || endpoint.socketPath !== p.socketPath || !/^[0-9a-f]{64}$/.test(endpoint.token)) throw failure("UNSAFE_ENDPOINT", "\u672C\u673A\u8FDE\u63A5\u4FE1\u606F\u65E0\u6548");
      const socketDirectory = await fs2.lstat(p.socketDirectory);
      assertPrivate(socketDirectory, "\u672C\u673A\u8FDE\u63A5\u76EE\u5F55");
      const socketStat = await fs2.lstat(p.socketPath).catch(() => {
        throw failure("SERVICE_UNAVAILABLE", "\u672C\u673A\u670D\u52A1\u5DF2\u65AD\u5F00");
      });
      assertPrivate(socketStat, "\u672C\u673A\u8FDE\u63A5");
      if (!socketStat.isSocket()) throw failure("UNSAFE_ENDPOINT", "\u672C\u673A\u8FDE\u63A5\u4E0D\u662F Unix socket");
      const id = crypto.randomUUID();
      const frame = JSON.stringify({ format: FORMAT, id, token: endpoint.token, method, params }) + "\n";
      if (Buffer.byteLength(frame) > MAX_FRAME) throw failure("REQUEST_TOO_LARGE", "\u7559\u5B58\u5185\u5BB9\u8D85\u8FC7\u672C\u673A\u4F20\u8F93\u9650\u5236");
      return new Promise((resolve, reject) => {
        const socket = net.createConnection(p.socketPath);
        let buffer = Buffer.alloc(0), done = false;
        const finish = (error, value) => {
          if (done) return;
          done = true;
          socket.destroy();
          error ? reject(error) : resolve(value);
        };
        socket.setTimeout(timeoutMs, () => finish(failure("TIMEOUT", "\u672C\u673A\u8BF7\u6C42\u7B49\u5F85\u8D85\u65F6\uFF0C\u8BF7\u91CD\u8BD5")));
        socket.on("connect", () => socket.write(frame));
        socket.on("error", () => finish(failure("SERVICE_UNAVAILABLE", "\u672C\u673A\u670D\u52A1\u5DF2\u65AD\u5F00")));
        socket.on("end", () => {
          if (!done) finish(failure("CONNECTION_CLOSED", "\u672C\u673A\u8FDE\u63A5\u672A\u8FD4\u56DE\u5B8C\u6574\u7ED3\u679C"));
        });
        socket.on("data", (chunk) => {
          buffer = Buffer.concat([buffer, chunk]);
          if (buffer.length > MAX_FRAME) return finish(failure("RESPONSE_TOO_LARGE", "\u672C\u673A\u54CD\u5E94\u8FC7\u5927"));
          const newline = buffer.indexOf(10);
          if (newline < 0) return;
          try {
            const response = JSON.parse(buffer.subarray(0, newline).toString("utf8"));
            if (!object(response) || response.id !== id || typeof response.ok !== "boolean") throw failure("INVALID_RESPONSE", "\u672C\u673A\u54CD\u5E94\u65E0\u6548");
            if (!response.ok) throw failure(response.error?.code || "REQUEST_FAILED", response.error?.message || "\u672C\u673A\u8BF7\u6C42\u672A\u5B8C\u6210");
            finish(null, response.result);
          } catch (error) {
            finish(error);
          }
        });
      });
    }
    module2.exports = { startPrivateServer, callPrivate, MAX_FRAME };
  }
});

// ../scripts/clipper-native-host.cjs
var fs = require("node:fs");
var path = require("node:path");
var os = require("node:os");
var HOST_NAME = "com.rabbit.mengcang.clipper";
var EXTENSION_ID = "ebdbkhhcgifolblbcpkpgibjbighfhgi";
var ORIGIN = `chrome-extension://${EXTENSION_ID}/`;
var MAX_INPUT = 1024 * 1024;
var MAX_OUTPUT = 256 * 1024;
var fail = (code, message) => Object.assign(new Error(message), { code });
function encodeMessage(value) {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  if (body.length > MAX_OUTPUT) throw fail("RESPONSE_TOO_LARGE", "\u672C\u673A\u4FDD\u5B58\u56DE\u6267\u8FC7\u5927\u3002");
  const frame = Buffer.allocUnsafe(body.length + 4);
  frame.writeUInt32LE(body.length, 0);
  body.copy(frame, 4);
  return frame;
}
function validateRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !["method", "params"].includes(key)) || !["status", "capture", "collections", "highlights", "related", "openRelated"].includes(value.method) || !value.params || typeof value.params !== "object" || Array.isArray(value.params)) throw fail("INVALID_REQUEST", "\u4E0D\u652F\u6301\u7684\u672C\u673A\u6536\u5F55\u8BF7\u6C42\u3002");
  if (value.method === "status" && Object.keys(value.params).length) throw fail("INVALID_REQUEST", "\u8FDE\u63A5\u68C0\u67E5\u4E0D\u63A5\u53D7\u989D\u5916\u53C2\u6570\u3002");
  return value;
}
function readConfig(directory = __dirname) {
  const fallback = path.join(os.homedir(), "Library", "Application Support", "\u68A6\u85CF", "browser-clipper");
  const filename = path.join(directory, "config.json");
  let stat;
  try {
    stat = fs.lstatSync(filename);
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw fail("HOST_CONFIG", "\u672C\u673A\u8FDE\u63A5\u914D\u7F6E\u65E0\u6CD5\u8BFB\u53D6\uFF0C\u8BF7\u91CD\u65B0\u5B89\u88C5\u8FDE\u63A5\u3002");
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192 || stat.mode & 63 || typeof process.getuid === "function" && stat.uid !== process.getuid()) throw fail("HOST_CONFIG", "\u672C\u673A\u8FDE\u63A5\u914D\u7F6E\u4E0D\u7B26\u5408\u79C1\u6709\u8BBF\u95EE\u9650\u5236\u3002");
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filename, "utf8"));
  } catch {
    throw fail("HOST_CONFIG", "\u672C\u673A\u8FDE\u63A5\u914D\u7F6E\u65E0\u6CD5\u8BFB\u53D6\uFF0C\u8BF7\u91CD\u65B0\u5B89\u88C5\u8FDE\u63A5\u3002");
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => key !== "bridgeDirectory") || typeof value.bridgeDirectory !== "string" || !path.isAbsolute(value.bridgeDirectory) || value.bridgeDirectory.includes("\0")) throw fail("HOST_CONFIG", "\u672C\u673A\u8FDE\u63A5\u914D\u7F6E\u65E0\u6548\uFF0C\u8BF7\u91CD\u65B0\u5B89\u88C5\u8FDE\u63A5\u3002");
  return value.bridgeDirectory;
}
async function handleRequest(request, { origin, directory, callPrivate } = {}) {
  if (origin !== ORIGIN) throw fail("FORBIDDEN_EXTENSION", "\u6B64\u6269\u5C55\u672A\u88AB\u5141\u8BB8\u8FDE\u63A5\u68A6\u85CF\u3002");
  const { method, params } = validateRequest(request);
  const call = callPrivate || require_private_rpc().callPrivate;
  try {
    return await call({ directory: directory || readConfig(), service: "browser-clipper", method, params, timeoutMs: method === "capture" ? 12e4 : 3e4 });
  } catch (error) {
    if (["SERVICE_UNAVAILABLE", "ENOENT", "ECONNREFUSED", "CONNECTION_CLOSED", "LIBRARY_NOT_READY"].includes(error.code)) throw fail("DESKTOP_UNAVAILABLE", "\u8BF7\u5148\u6253\u5F00\u68A6\u85CF\uFF0C\u5E76\u7B49\u5F85\u8D44\u6599\u5E93\u52A0\u8F7D\u5B8C\u6210\u540E\u91CD\u8BD5\u3002");
    if (["TIMEOUT", "RECALL_TIMEOUT"].includes(error.code)) throw fail("SAVE_UNCONFIRMED", "\u5C1A\u672A\u786E\u8BA4\u4FDD\u5B58\u7ED3\u679C\uFF0C\u8BF7\u4FDD\u6301\u68A6\u85CF\u6253\u5F00\uFF0C\u5E76\u4F7F\u7528\u539F\u8BF7\u6C42\u91CD\u8BD5\u3002");
    throw fail(/^[A-Z0-9_]{1,64}$/.test(error.code || "") ? error.code : "CAPTURE_FAILED", error.message || "\u6536\u5F55\u672A\u5B8C\u6210\uFF0C\u8BF7\u91CD\u8BD5\u3002");
  }
}
async function runNativeHost({ input = process.stdin, output = process.stdout, origin = process.argv[2], directory, callPrivate } = {}) {
  let buffer = Buffer.alloc(0), length = null, accepted = false, settled = false;
  return await new Promise((resolve) => {
    const finish = (value) => {
      if (settled) return;
      let frame;
      try {
        frame = encodeMessage(value);
      } catch {
        frame = encodeMessage({ ok: false, error: { code: "RESPONSE_TOO_LARGE", message: "\u672C\u673A\u54CD\u5E94\u8D85\u8FC7\u4F20\u8F93\u4E0A\u9650\uFF0C\u8BF7\u7F29\u5C0F\u67E5\u8BE2\u8303\u56F4\u540E\u91CD\u8BD5\u3002" } });
      }
      settled = true;
      clearTimeout(timer);
      input.removeListener("data", receive);
      input.removeListener("end", ended);
      input.pause();
      output.write(frame, resolve);
    };
    const reject = (error) => finish({ ok: false, error: { code: error.code || "INVALID_REQUEST", message: error.message || "\u65E0\u6CD5\u8BFB\u53D6\u672C\u673A\u8BF7\u6C42\u3002" } });
    const timer = setTimeout(() => reject(fail("INPUT_TIMEOUT", "\u672C\u673A\u8BF7\u6C42\u8BFB\u53D6\u8D85\u65F6\u3002")), 5e3);
    const ended = () => {
      if (!accepted) reject(fail("INVALID_REQUEST", "\u672C\u673A\u8BF7\u6C42\u4E0D\u5B8C\u6574\u3002"));
    };
    const receive = (chunk) => {
      if (accepted || settled) return;
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_INPUT + 4) return reject(fail("REQUEST_TOO_LARGE", "\u6536\u5F55\u8BF7\u6C42\u8D85\u8FC7\u4F20\u8F93\u9650\u5236\u3002"));
      if (length === null && buffer.length >= 4) {
        length = buffer.readUInt32LE(0);
        if (!length || length > MAX_INPUT) return reject(fail("REQUEST_TOO_LARGE", "\u6536\u5F55\u8BF7\u6C42\u8D85\u8FC7\u4F20\u8F93\u9650\u5236\u3002"));
      }
      if (length === null || buffer.length < length + 4) return;
      if (buffer.length !== length + 4) return reject(fail("INVALID_REQUEST", "\u4E00\u6B21\u8FDE\u63A5\u53EA\u63A5\u53D7\u4E00\u6761\u6536\u5F55\u8BF7\u6C42\u3002"));
      accepted = true;
      clearTimeout(timer);
      let value;
      try {
        value = JSON.parse(buffer.subarray(4).toString("utf8"));
      } catch {
        return reject(fail("INVALID_REQUEST", "\u65E0\u6CD5\u89E3\u6790\u672C\u673A\u8BF7\u6C42\u3002"));
      }
      handleRequest(value, { origin, directory, callPrivate }).then((data) => finish({ ok: true, data }), reject);
    };
    input.on("data", receive);
    input.on("end", ended);
    input.on("error", () => reject(fail("INPUT_FAILED", "\u672C\u673A\u8F93\u5165\u8FDE\u63A5\u5DF2\u4E2D\u65AD\u3002")));
    if (origin !== ORIGIN) reject(fail("FORBIDDEN_EXTENSION", "\u6B64\u6269\u5C55\u672A\u88AB\u5141\u8BB8\u8FDE\u63A5\u68A6\u85CF\u3002"));
  });
}
if (require.main === module) runNativeHost().then(() => {
  process.exitCode = 0;
}, () => {
  process.exitCode = 1;
});
module.exports = { HOST_NAME, EXTENSION_ID, ORIGIN, MAX_INPUT, encodeMessage, validateRequest, readConfig, handleRequest, runNativeHost };
