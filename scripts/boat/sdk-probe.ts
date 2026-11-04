import { BoatApi, Configuration, FetchError, ResponseError } from "@boatdev/sdk";

// Development-only probe. Every request terminates in an injected fake fetch.
// No provider key, account, machine, or real network transport is involved.
export async function probeBoatSdk() {
  const basePath = "https://boat-probe.invalid/api/v1";
  const token = "synthetic-probe-value";
  const client = (fetchApi: typeof fetch) => new BoatApi(new Configuration({
    basePath,
    accessToken: token,
    fetchApi,
    middleware: [],
  }));
  const controller = new AbortController();
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const api = client(async (url, init = {}) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({
      ok: true, type: "command.started", success: true,
      processId: 42, pid: 42, command: "printf probe",
      startedAt: "2026-01-01T00:00:00Z",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  await api.createRaw({
    noEnv: true, ttlSeconds: 60, org: "fixture-wallet",
    idempotencyKey: "stable-probe-key",
  }, { signal: controller.signal });
  const command = await api.command({
    sandboxId: "probe/sandbox", command: "printf probe", detached: true,
  }, { signal: controller.signal });
  const create = requests[0];
  const headers = new Headers(create?.init.headers);
  const body = JSON.parse(String(create?.init.body));

  let lostCalls = 0;
  let lostError = false;
  try {
    await client(async () => {
      lostCalls++;
      throw new TypeError("Synthetic lost reply");
    }).command({ sandboxId: "probe", command: "printf probe", detached: true });
  } catch (error) {
    lostError = error instanceof FetchError;
  }

  let httpErrorsNotRetried = true;
  for (const status of [409, 429, 502]) {
    let calls = 0;
    let rejected = false;
    try {
      await client(async () => {
        calls++;
        return new Response("{}", { status });
      }).createRaw({ noEnv: true, idempotencyKey: "stable-probe-key" });
    } catch (error) {
      rejected = error instanceof ResponseError && error.response.status === status;
    }
    httpErrorsNotRetried &&= calls === 1 && rejected;
  }

  const abort = new AbortController();
  let abortCalls = 0;
  let signalForwarded = false;
  let aborted = false;
  try {
    await client(async (_url, init) => {
      abortCalls++;
      signalForwarded = init?.signal === abort.signal;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("Synthetic abort")), { once: true });
        abort.abort();
      });
    }).command({ sandboxId: "probe", command: "printf probe", detached: true }, { signal: abort.signal });
  } catch (error) {
    aborted = error instanceof FetchError;
  }

  return {
    injectedFetch: requests.length === 2 && requests.every(({ url, init }) =>
      url.startsWith(`${basePath}/sandboxes`) && init.signal === controller.signal),
    requestInputs: create.url === `${basePath}/sandboxes?org=fixture-wallet`
      && headers.get("Authorization") === `Bearer ${token}`
      && headers.get("Idempotency-Key") === "stable-probe-key"
      && body.noEnv === true && body.ttlSeconds === 60,
    detachedCommand: requests[1].url.endsWith("/probe%2Fsandbox/commands")
      && JSON.parse(String(requests[1].init.body)).detached === true
      && "processId" in command && command.processId === 42,
    abortForwarded: abortCalls === 1 && signalForwarded && aborted,
    lostReplyNotRetried: lostCalls === 1 && lostError,
    httpErrorsNotRetried,
  };
}
