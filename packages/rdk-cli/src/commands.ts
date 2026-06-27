/**
 * Command handlers for `qorollup`. Each takes a {@link CliContext} and the parsed
 * args and returns a process exit code. Handlers are side-effect-light (all I/O
 * goes through the context's client/out), so they unit-test cleanly with a mock
 * client and a {@link MockTxClient}.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { confirm, isCancel } from "@clack/prompts";
import {
  MockTxClient,
  RdkTxClient,
  PROFILE_NAMES,
  assembleWithdrawalProof,
  buildExecuteWithdrawalInput,
  checkPreflight,
  deriveNativeAccount,
  estimateCreationCost,
  findRdkEvent,
  generateMnemonic,
  getRollupHealth,
  hexToBytes,
  presets,
  requestFaucet,
  signerFromEnv,
  toManifest,
  stringifyManifest,
  parseManifest,
  fromManifest,
  uqorToQor,
  watchRollup,
  watchBatches,
  getRollupAdvice,
  buildSettlementReceipt,
  verifySettlementReceipt,
  type ProfileName,
  type RawEvent,
} from "@qorechain/rdk";
import { flagBool, flagStr, type ParsedCli } from "./args";
import type { CliContext } from "./context";

async function resolveSignerAddress(ctx: CliContext): Promise<string | undefined> {
  const signer = await signerFromEnv(ctx.signerEnv);
  if (!signer) return undefined;
  return (await signer.getAccounts())[0]?.address;
}

function profileFromFlags(parsed: ParsedCli): ProfileName {
  const p = (flagStr(parsed.flags, "profile") ?? "defi") as ProfileName;
  return (PROFILE_NAMES as readonly string[]).includes(p) ? p : "defi";
}

function builderFromFlags(parsed: ParsedCli) {
  const rollupId = flagStr(parsed.flags, "rollup-id") ?? parsed.positionals[0] ?? "";
  return presets[profileFromFlags(parsed)]({ rollupId });
}

async function confirmOrYes(ctx: CliContext, message: string): Promise<boolean> {
  if (ctx.yes) return true;
  const ok = await confirm({ message });
  return !isCancel(ok) && ok === true;
}

export async function cmdDoctor(ctx: CliContext, parsed: ParsedCli): Promise<number> {
  const signerAddress = await resolveSignerAddress(ctx);
  const config = flagStr(parsed.flags, "profile") ? builderFromFlags(parsed).get() : undefined;
  const result = await checkPreflight(ctx.client, {
    config,
    signerAddress,
    expectedNetwork: ctx.network,
  });
  if (ctx.json) {
    ctx.out.json(result);
    return result.ok ? 0 : 1;
  }
  ctx.out.line(`Preflight (${ctx.network} — ${ctx.client.network.chainId}):`);
  for (const c of result.checks) {
    const tail = `${c.label}${c.detail ? ` — ${c.detail}` : ""}${c.hint ? ` (${c.hint})` : ""}`;
    if (c.status === "ok") ctx.out.success(tail);
    else if (c.status === "warn") ctx.out.warn(tail);
    else ctx.out.error(tail);
  }
  ctx.out.line(result.ok ? "All checks passed." : "Some checks failed.");
  return result.ok ? 0 : 1;
}

export async function cmdCreate(ctx: CliContext, parsed: ParsedCli): Promise<number> {
  const builder = builderFromFlags(parsed);
  const validation = builder.validationResult();
  if (!builder.get().rollupId) {
    ctx.out.error("a rollup id is required (--rollup-id <id>)");
    return 1;
  }
  if (!validation.valid) {
    ctx.out.error(`invalid config: ${validation.errors.join("; ")}`);
    return 1;
  }
  validation.warnings.forEach((w) => ctx.out.warn(w));

  const params = await ctx.client.params();
  const stake = flagStr(parsed.flags, "stake-uqor") ?? params.minStakeForRollup;
  const cost = estimateCreationCost({ stakeUqor: stake, burnRate: params.rollupCreationBurnRate });
  const cfg = builder.get();
  ctx.out.line(`Create rollup "${cfg.rollupId}" (profile ${cfg.profile}, ${cfg.settlement}/${cfg.vmType})`);
  ctx.out.line(`Stake ${uqorToQor(cost.stakeUqor)} QOR — burned on creation: ${uqorToQor(cost.burnUqor)} QOR`);

  if (flagBool(parsed.flags, "dry-run")) {
    const addr = (await resolveSignerAddress(ctx)) ?? "qor1operator";
    const tx = RdkTxClient.fromClient(new MockTxClient(), addr);
    await tx.createRollup({ rollupId: cfg.rollupId, profile: cfg.profile, vmType: cfg.vmType, stakeAmount: stake });
    ctx.out.success("Dry run OK — would submit MsgCreateRollup (no broadcast).");
    if (ctx.json) ctx.out.json({ dryRun: true, rollupId: cfg.rollupId, cost });
    return 0;
  }

  if (!(await confirmOrYes(ctx, `Create "${cfg.rollupId}" on ${ctx.network}?`))) {
    ctx.out.line("Cancelled.");
    return 1;
  }

  const tx = await ctx.connectTx();
  const msg = builder.toCreateMsg(tx.address, { stakeAmount: stake });
  const res = await tx.createRollup({
    rollupId: msg.rollupId,
    profile: msg.profile,
    vmType: msg.vmType,
    stakeAmount: msg.stakeAmount,
  });
  const created = findRdkEvent((res.events ?? []) as RawEvent[], "rollup_created");
  ctx.out.success(`Created — tx ${res.transactionHash} (code ${res.code})`);
  if (created) ctx.out.line(`rollup_created: ${JSON.stringify(created.attributes)}`);
  if (ctx.json) ctx.out.json({ transactionHash: res.transactionHash, code: res.code, rollupId: cfg.rollupId });
  return res.code === 0 ? 0 : 1;
}

function rollupIdArg(parsed: ParsedCli): string | undefined {
  return flagStr(parsed.flags, "rollup-id") ?? parsed.positionals[0];
}

export async function cmdStatus(ctx: CliContext, parsed: ParsedCli): Promise<number> {
  const rollupId = rollupIdArg(parsed);
  if (!rollupId) {
    ctx.out.error("usage: qorollup status <rollup-id>");
    return 1;
  }
  const rollup = await ctx.client.rest.getRollup(rollupId);
  const health = await getRollupHealth(ctx.client, rollupId);
  if (ctx.json) {
    ctx.out.json({ rollup, health });
    return 0;
  }
  ctx.out.line(`Rollup ${rollupId}`);
  ctx.out.line(`  status:     ${rollup.status}`);
  ctx.out.line(`  profile:    ${rollup.profile}`);
  ctx.out.line(`  settlement: ${rollup.settlementMode}`);
  ctx.out.line(`  DA:         ${rollup.daBackend}`);
  ctx.out.line(`  VM:         ${rollup.vmType}`);
  if (health.hasBatches) {
    ctx.out.line(`  latest batch #${health.latestBatchIndex} (${health.latestBatchStatus}), age ${health.batchAgeSecs}s`);
    if (health.secondsUntilChallengeDeadline !== undefined) {
      ctx.out.line(`  challenge window closes in ${health.secondsUntilChallengeDeadline}s`);
    }
  } else {
    ctx.out.line("  no settlement batches yet");
  }
  ctx.out.line(health.healthy ? "Healthy." : "Attention needed.");
  return 0;
}

export async function cmdParams(ctx: CliContext): Promise<number> {
  const params = await ctx.client.params();
  if (ctx.json) {
    ctx.out.json(params);
    return 0;
  }
  ctx.out.line("Module parameters (live):");
  ctx.out.line(`  max rollups:        ${params.maxRollups}`);
  ctx.out.line(`  min stake:          ${uqorToQor(params.minStakeForRollup)} QOR`);
  ctx.out.line(`  creation burn:      ${Number(params.rollupCreationBurnRate) * 100}%`);
  ctx.out.line(`  challenge window:   ${params.defaultChallengeWindow}s`);
  ctx.out.line(`  max DA blob size:   ${params.maxDaBlobSize} bytes`);
  ctx.out.line(`  blob retention:     ${params.blobRetentionBlocks} blocks`);
  ctx.out.line(`  max batches/block:  ${params.maxBatchesPerBlock}`);
  return 0;
}

export async function cmdSuggest(ctx: CliContext, parsed: ParsedCli): Promise<number> {
  const useCase = parsed.positionals.join(" ") || flagStr(parsed.flags, "use-case") || "";
  if (!useCase) {
    ctx.out.error('usage: qorollup suggest "<describe your app>"');
    return 1;
  }
  const suggestion = await ctx.client.suggestProfile(useCase);
  if (ctx.json) {
    ctx.out.json(suggestion);
    return 0;
  }
  ctx.out.success(`Suggested profile: ${suggestion.profile} (source: ${suggestion.source})`);
  return 0;
}

export async function cmdLifecycle(
  ctx: CliContext,
  parsed: ParsedCli,
  action: "pause" | "resume" | "stop",
): Promise<number> {
  const rollupId = rollupIdArg(parsed);
  if (!rollupId) {
    ctx.out.error(`usage: qorollup ${action} <rollup-id>`);
    return 1;
  }
  const rollup = await ctx.client.rest.getRollup(rollupId);
  if (!(await confirmOrYes(ctx, `${action} rollup "${rollupId}" (currently ${rollup.status})?`))) {
    ctx.out.line("Cancelled.");
    return 1;
  }
  const tx = await ctx.connectTx();
  const status = rollup.status as "pending" | "active" | "paused" | "stopped";
  const reason = flagStr(parsed.flags, "reason");
  const res =
    action === "pause"
      ? await tx.pauseRollup({ rollupId, reason, currentStatus: status })
      : action === "resume"
        ? await tx.resumeRollup({ rollupId, currentStatus: status })
        : await tx.stopRollup({ rollupId, currentStatus: status });
  ctx.out.success(`${action} submitted — tx ${res.transactionHash} (code ${res.code})`);
  if (ctx.json) ctx.out.json({ action, rollupId, transactionHash: res.transactionHash, code: res.code });
  return res.code === 0 ? 0 : 1;
}

export async function cmdKeygen(ctx: CliContext): Promise<number> {
  const mnemonic = generateMnemonic();
  const account = await deriveNativeAccount(mnemonic);
  if (ctx.json) {
    ctx.out.json({ address: account.address, mnemonic });
    return 0;
  }
  ctx.out.warn("Store this mnemonic securely and OFFLINE. Anyone with it controls the account.");
  ctx.out.line(`address:  ${account.address}`);
  ctx.out.line(`mnemonic: ${mnemonic}`);
  return 0;
}

export async function cmdManifest(ctx: CliContext, parsed: ParsedCli): Promise<number> {
  const sub = parsed.positionals[0];
  if (sub === "export") {
    const rollupId = flagStr(parsed.flags, "rollup-id");
    if (!rollupId) {
      ctx.out.error("a rollup id is required (--rollup-id <id>)");
      return 1;
    }
    const builder = presets[profileFromFlags(parsed)]({ rollupId });
    const manifest = toManifest(builder.get(), {
      network: ctx.network,
      chainId: ctx.client.network.chainId,
      endpoints: ctx.client.network.endpoints,
      createdAt: flagStr(parsed.flags, "created-at"),
    });
    const json = stringifyManifest(manifest);
    const outFile = flagStr(parsed.flags, "out");
    if (outFile) {
      writeFileSync(outFile, json);
      ctx.out.success(`Wrote manifest to ${outFile}`);
    } else if (ctx.json) {
      ctx.out.json(manifest);
    } else {
      ctx.out.line(json);
    }
    return 0;
  }
  if (sub === "import") {
    const file = parsed.positionals[1] ?? flagStr(parsed.flags, "file");
    if (!file) {
      ctx.out.error("usage: qorollup manifest import <file>");
      return 1;
    }
    const manifest = parseManifest(readFileSync(file, "utf8"));
    const builder = fromManifest(manifest);
    const result = builder.validationResult();
    if (ctx.json) {
      ctx.out.json({ config: builder.get(), valid: result.valid, errors: result.errors });
    } else {
      ctx.out.line(`Loaded rollup "${builder.get().rollupId}" (${builder.get().profile})`);
      ctx.out.line(result.valid ? "Config valid." : `Invalid: ${result.errors.join("; ")}`);
    }
    return result.valid ? 0 : 1;
  }
  ctx.out.error("usage: qorollup manifest <export|import> [...]");
  return 1;
}

export async function cmdFaucet(ctx: CliContext, parsed: ParsedCli): Promise<number> {
  const address = parsed.positionals[0] ?? flagStr(parsed.flags, "address");
  if (!address) {
    ctx.out.error("usage: qorollup faucet <address>");
    return 1;
  }
  const result = await requestFaucet({ url: ctx.faucetUrl, address, fetch: ctx.fetch });
  ctx.out.success(`Faucet request accepted (status ${result.status}).`);
  if (ctx.json) ctx.out.json(result);
  return 0;
}

export async function cmdWithdraw(ctx: CliContext, parsed: ParsedCli): Promise<number> {
  const file = flagStr(parsed.flags, "file");
  if (!file) {
    ctx.out.error("usage: qorollup withdraw --file <withdrawal.json>");
    return 1;
  }
  const spec = JSON.parse(readFileSync(file, "utf8")) as {
    rollupId: string;
    batchIndex: number;
    recipient: string;
    denom: string;
    amount: string | number;
    leaves: string[];
    index: number;
  };
  const leaves = spec.leaves.map((h) => hexToBytes(h));
  const proof = assembleWithdrawalProof(leaves, spec.index);
  if (flagBool(parsed.flags, "dry-run")) {
    ctx.out.success(`Assembled withdrawal proof (${proof.proof.length} sibling hashes). Dry run — not submitted.`);
    return 0;
  }
  const tx = await ctx.connectTx();
  const input = buildExecuteWithdrawalInput({
    submitter: tx.address,
    rollupId: spec.rollupId,
    batchIndex: spec.batchIndex,
    recipient: spec.recipient,
    denom: spec.denom,
    amount: spec.amount,
    withdrawal: proof,
  });
  const res = await tx.executeWithdrawal({
    rollupId: input.rollupId,
    batchIndex: input.batchIndex,
    withdrawalIndex: input.withdrawalIndex,
    recipient: input.recipient,
    denom: input.denom,
    amount: input.amount,
    proof: input.proof,
  });
  ctx.out.success(`Withdrawal submitted — tx ${res.transactionHash} (code ${res.code})`);
  return res.code === 0 ? 0 : 1;
}

export async function cmdWatch(ctx: CliContext, parsed: ParsedCli): Promise<number> {
  const rollupId = rollupIdArg(parsed);
  if (!rollupId) {
    ctx.out.error("usage: qorollup watch <rollup-id>");
    return 1;
  }
  const intervalMs = Number(flagStr(parsed.flags, "interval") ?? "5000");
  ctx.out.line(`Watching ${rollupId} (every ${intervalMs}ms; Ctrl-C to stop)…`);
  await new Promise<void>((resolve) => {
    const controller = new AbortController();
    const onSig = (): void => controller.abort();
    if (typeof process !== "undefined") process.once("SIGINT", onSig);
    watchRollup(ctx.client, rollupId, {
      intervalMs,
      signal: controller.signal,
      onUpdate: (h) =>
        ctx.out.line(
          `[${h.status}] batch #${h.latestBatchIndex ?? "-"} (${h.latestBatchStatus ?? "none"}) ${h.healthy ? "healthy" : "attention"}`,
        ),
      onError: (e) => ctx.out.warn(e instanceof Error ? e.message : String(e)),
    });
    controller.signal.addEventListener("abort", () => resolve(), { once: true });
  });
  return 0;
}

export async function cmdAdvise(ctx: CliContext, parsed: ParsedCli): Promise<number> {
  const rollupId = rollupIdArg(parsed);
  if (!rollupId) {
    ctx.out.error("usage: qorollup advise <rollup-id>");
    return 1;
  }
  const advice = await getRollupAdvice(ctx.client, rollupId);
  if (ctx.json) {
    ctx.out.json(advice);
    return 0;
  }
  ctx.out.line(`QCAI Copilot — ${rollupId} (status: ${advice.status})`);
  for (const s of advice.suggestions) {
    const tag = s.level === "action" ? "ACTION" : s.level === "warn" ? "WARN " : "info ";
    ctx.out.line(`  [${tag}] ${s.message}`);
  }
  if (advice.fraudInvestigations.length > 0) {
    ctx.out.line(`  ${advice.fraudInvestigations.length} fraud investigation(s) reference this rollup.`);
  }
  for (const w of advice.warnings) ctx.out.warn(`advisory unavailable — ${w}`);
  return 0;
}

export async function cmdReceipt(ctx: CliContext, parsed: ParsedCli): Promise<number> {
  const rollupId = rollupIdArg(parsed);
  const idxRaw = parsed.positionals[1] ?? flagStr(parsed.flags, "batch");
  if (!rollupId || idxRaw === undefined) {
    ctx.out.error("usage: qorollup receipt <rollup-id> <batch-index> [--verify] [--out <file>]");
    return 1;
  }
  const batchIndex = Number(idxRaw);
  const receipt = await buildSettlementReceipt(ctx.client, rollupId, batchIndex);

  let verification: Awaited<ReturnType<typeof verifySettlementReceipt>> | undefined;
  if (flagBool(parsed.flags, "verify")) {
    verification = await verifySettlementReceipt(receipt, { client: ctx.client });
  }

  const outFile = flagStr(parsed.flags, "out");
  if (outFile) writeFileSync(outFile, `${JSON.stringify(receipt, null, 2)}\n`);

  if (ctx.json) {
    ctx.out.json({ receipt, verification });
    return verification && !verification.valid ? 1 : 0;
  }
  ctx.out.line(`Settlement receipt — ${rollupId} batch #${batchIndex}`);
  ctx.out.line(`  layer:        ${receipt.layerId} @ height ${receipt.layerHeight}`);
  ctx.out.line(`  state root:   ${receipt.stateRoot}`);
  ctx.out.line(`  main height:  ${receipt.mainChainHeight}`);
  ctx.out.line(`  algorithm:    ${receipt.algorithm}`);
  ctx.out.line(`  signature:    ${receipt.pqcSignature.slice(0, 24)}… (${receipt.pqcSignature.length / 2} bytes)`);
  if (outFile) ctx.out.line(`  written to:   ${outFile}`);
  if (verification) {
    if (verification.valid) {
      ctx.out.success("Verified — quantum-safe anchor signature and state-root binding hold.");
    } else {
      ctx.out.error(`Verification FAILED — ${verification.reason}`);
      return 1;
    }
  }
  return 0;
}

export async function cmdWatchtower(ctx: CliContext, parsed: ParsedCli): Promise<number> {
  const rollupId = rollupIdArg(parsed);
  if (!rollupId) {
    ctx.out.error("usage: qorollup watchtower <rollup-id> [--interval <ms>]");
    return 1;
  }
  const intervalMs = Number(flagStr(parsed.flags, "interval") ?? "5000");
  ctx.out.line(`Watchtower on ${rollupId} (every ${intervalMs}ms; Ctrl-C to stop).`);
  ctx.out.line("Note: supply your own validity check to auto-flag batches; this CLI only reports.");
  await new Promise<void>((resolve) => {
    const controller = new AbortController();
    const onSig = (): void => controller.abort();
    if (typeof process !== "undefined") process.once("SIGINT", onSig);
    watchBatches(ctx.client, rollupId, {
      intervalMs,
      signal: controller.signal,
      onBatch: (b) =>
        ctx.out.line(`new batch #${b.batchIndex} (${b.status}) state ${b.stateRoot.slice(0, 16)}…`),
      onDeadline: (info) =>
        ctx.out.warn(
          `batch #${info.batch.batchIndex} challenge window closes in ${info.secondsRemaining}s`,
        ),
      onError: (e) => ctx.out.warn(e instanceof Error ? e.message : String(e)),
    });
    controller.signal.addEventListener("abort", () => resolve(), { once: true });
  });
  return 0;
}
