import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useBalance, useConnect, usePublicClient, useReadContract, useSwitchChain } from "wagmi";
import { formatUnits, parseEther, parseUnits } from "viem";
import { banqorFactoryAbi, banqorVaultAbi, borrowerOperationsAbi, computeHints, previewOpenLine, priceFeedAbi } from "@banqor/sdk";
import { chain, deployment, settings } from "../config";
import { num, onMezo, ratio, toNum, useLineStatus, usd } from "../lib";
import { useTx } from "../tx";
import { useMezoParams, useVault } from "../hooks";
import { href } from "../route";

const E18 = 10n ** 18n;
const PRESETS = [
  { name: "Careful", bps: 30000 },
  { name: "Balanced", bps: 25000 },
  { name: "Tight", bps: 21000 },
];
const safeParse = (s: string, f: (s: string) => bigint) => {
  try {
    const v = s.trim() ? f(s.trim()) : undefined;
    return v !== undefined && v > 0n ? v : undefined;
  } catch {
    return undefined;
  }
};

/** Open a line (FR-UI2): create the vault, size the line against Mezo's live price and rules, then add an agent. */
export function OpenLine() {
  const v = useVault();
  const vault = v.ownVault;
  const factory = deployment.banqor.factory;
  const client = usePublicClient(onMezo);
  const tx = useTx();
  const { connect, connectors } = useConnect();
  const { switchChain } = useSwitchChain();
  const { data: line } = useLineStatus(vault);
  const defaults = useReadContract({ ...onMezo, address: factory ?? undefined, abi: banqorFactoryAbi, functionName: "defaults", query: { enabled: !!factory } });
  const { data: price } = useReadContract({ ...onMezo, address: deployment.mezo.priceFeed, abi: priceFeedAbi, functionName: "fetchPrice", query: { refetchInterval: settings.pollMs } });
  const { data: feePerUnit } = useReadContract({ ...onMezo, address: deployment.mezo.borrowerOperations, abi: borrowerOperationsAbi, functionName: "getBorrowingFee", args: [E18] });
  const { gasComp, minNetDebt } = useMezoParams();
  const { data: bal } = useBalance({ ...onMezo, address: v.address, query: { enabled: !!v.address } });
  const floorBps = line?.icrFloorBps ?? defaults.data?.icrFloorBps;

  const [collRaw, setColl] = useState("");
  const [borrowRaw, setBorrow] = useState("");
  const [opened, setOpened] = useState<{ coll: bigint; borrow: bigint; icrBps: bigint }>();

  // the smallest loan Mezo accepts: borrow + fee >= minNetDebt
  const minBorrow = minNetDebt !== undefined && feePerUnit !== undefined ? (minNetDebt * E18 + E18 + feePerUnit - 1n) / (E18 + feePerUnit) : undefined;
  useEffect(() => {
    if (minBorrow !== undefined && borrowRaw === "") setBorrow(String(Math.ceil(toNum(minBorrow))));
  }, [minBorrow]); // eslint-disable-line react-hooks/exhaustive-deps

  const coll = safeParse(collRaw, parseEther);
  const borrow = safeParse(borrowRaw, (s) => parseUnits(s, 18));
  const preview = useQuery({
    queryKey: ["preview", String(coll), String(borrow), floorBps],
    enabled: !!client && coll !== undefined && borrow !== undefined && floorBps !== undefined,
    queryFn: () => previewOpenLine(client!, deployment.mezo, coll!, borrow!, BigInt(floorBps!)),
  });
  const p = preview.data;

  // the most you can borrow and still start at the floor
  const borrowFor = (c: bigint, targetBps: number) => {
    if (price === undefined || gasComp === undefined || feePerUnit === undefined) return undefined;
    const maxDebt = (c * price * 10_000n) / (BigInt(targetBps) * E18);
    return maxDebt > gasComp ? ((maxDebt - gasComp) * E18) / (E18 + feePerUnit) : 0n;
  };
  const maxBorrow = coll !== undefined && floorBps !== undefined ? borrowFor(coll, floorBps) : undefined;

  let err = "";
  if (coll === undefined) err = "Enter how much BTC to lock.";
  else if (bal && coll > bal.value) err = `Your wallet has ${num(bal.value, 4)} BTC.`;
  else if (borrow === undefined) err = "Enter how much MUSD to borrow.";
  else if (p && !p.meetsMinDebt) err = `Mezo lines start at ${Math.ceil(toNum(minBorrow ?? p.minNetDebt)).toLocaleString("en-US")} MUSD.`;
  else if (p && floorBps !== undefined && p.icrBps < BigInt(floorBps))
    err = `That starts at ${ratio(p.icrBps)}, under the ${floorBps / 100}% floor, so the vault would refuse it. Lock more BTC or borrow less.`;
  const ready = !err && !!p && !preview.isFetching;

  function applyPreset(bps: number) {
    if (coll === undefined || minBorrow === undefined || price === undefined || gasComp === undefined || feePerUnit === undefined) return;
    const b = borrowFor(coll, bps)!;
    if (b >= minBorrow) setBorrow(String(Math.floor(toNum(b))));
    else {
      // not enough BTC for that safety level at the minimum loan: size the BTC instead
      const debt = (minBorrow * (E18 + feePerUnit)) / E18 + gasComp;
      const need = (debt * BigInt(bps) * E18) / (price * 10_000n);
      setBorrow(String(Math.ceil(toNum(minBorrow))));
      setColl((Math.ceil(toNum(need) * 1e4) / 1e4).toFixed(4));
    }
  }

  async function open() {
    if (!vault || !p || coll === undefined || borrow === undefined) return;
    const ok = await tx.run("Open the line", async () => {
      const [u, l] = await computeHints(client!, deployment.mezo, coll, p.compositeDebt, settings.hintTrials);
      return { address: vault, abi: banqorVaultAbi, functionName: "openLine", args: [borrow, u, l], value: coll };
    });
    if (ok) setOpened({ coll, borrow, icrBps: p.icrBps });
  }

  const alreadyOpen = !opened && !!line?.lineOpen;
  const step = opened || alreadyOpen ? 3 : vault ? 2 : 1;
  const stClass = (i: number) => `st${i < step || alreadyOpen ? " done" : i === step ? " current" : ""}`;

  return (
    <div className="pg-open">
      <div className="head">
        <div>
          <h1>Open a credit line</h1>
          <div className="sub">
            <span className="mute">Lock BTC on Mezo, borrow MUSD against it, and let your agents spend inside the limits you set. About two minutes and three transactions.</span>
          </div>
        </div>
      </div>

      <div className="grid">
        <div className="steps">
          <ol className="stepper" aria-label="Progress">
            <li className={stClass(1)} aria-current={step === 1 ? "step" : undefined}>
              <span className="dn">1</span>
              <span className="tx">
                <b>Create vault</b>
                <small>{vault ? "Vault created" : "One per wallet"}</small>
              </span>
            </li>
            <li className={stClass(2)} aria-current={step === 2 ? "step" : undefined}>
              <span className="dn">2</span>
              <span className="tx">
                <b>Lock &amp; borrow</b>
                <small>{opened ? `${num(opened.coll, 4)} BTC · ${num(opened.borrow, 0)} MUSD` : alreadyOpen ? "Line is open" : "BTC in, MUSD out"}</small>
              </span>
            </li>
            <li className={stClass(3)} aria-current={step === 3 ? "step" : undefined}>
              <span className="dn">3</span>
              <span className="tx">
                <b>First agent</b>
                <small>Set its limits</small>
              </span>
            </li>
          </ol>

          {step === 1 && (
            <section className="stage" aria-labelledby="s1-h">
              <p className="eyebrow">Step 1 of 3</p>
              <h2 id="s1-h">Create your vault</h2>
              <p className="lead">Your vault is a small contract only you control. It holds the credit line and your agents' rules. Each wallet gets one, made by the BanQor factory.</p>
              <div className="stage-acts">
                {!factory ? (
                  <p className="alert">There's no BanQor factory in deployments/{deployment.chainId}.json yet.</p>
                ) : !v.isConnected ? (
                  <button className="btn btn-orange" type="button" disabled={!connectors[0]} onClick={() => connect({ connector: connectors[0], chainId: chain.id })}>
                    Connect wallet
                  </button>
                ) : v.wrongChain ? (
                  <button className="btn btn-orange" type="button" onClick={() => switchChain({ chainId: chain.id })}>
                    Switch to Mezo
                  </button>
                ) : v.loading ? (
                  <button className="btn btn-orange" type="button" disabled>
                    Looking up your vault…
                  </button>
                ) : (
                  <button className="btn btn-orange" type="button" disabled={tx.busy} onClick={() => tx.run("Create vault", { address: factory, abi: banqorFactoryAbi, functionName: "createVault" })}>
                    Create vault
                  </button>
                )}
              </div>
            </section>
          )}

          {step === 2 && (
            <section className="stage" aria-labelledby="s2-h">
              <p className="eyebrow">Step 2 of 3</p>
              <h2 id="s2-h">Lock BTC and borrow</h2>
              <p className="lead">BTC is Mezo's native coin, so it goes in with the transaction. Keep a little in your wallet for gas.</p>
              <form
                className="form"
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  if (ready) void open();
                }}
              >
                <div className="field">
                  <label htmlFor="coll">BTC to lock</label>
                  <div className="inwrap">
                    <input id="coll" inputMode="decimal" autoComplete="off" placeholder="0.00" value={collRaw} onChange={(e) => setColl(e.target.value)} />
                    <span className="unit">BTC</span>
                  </div>
                  <span className="hint">
                    {coll !== undefined && price !== undefined ? `About ${usd((coll * price) / E18)} at today's price.` : ""}
                    {bal ? ` Your wallet: ${num(bal.value, 4)} BTC.` : ""}
                  </span>
                </div>
                <div className="field">
                  <label htmlFor="borrow">MUSD to borrow</label>
                  <div className="inwrap">
                    <input id="borrow" inputMode="decimal" autoComplete="off" value={borrowRaw} onChange={(e) => setBorrow(e.target.value)} />
                    <span className="unit">MUSD</span>
                  </div>
                  {minBorrow !== undefined && maxBorrow !== undefined && maxBorrow > minBorrow && (
                    <>
                      <input
                        className="slider"
                        type="range"
                        aria-label="MUSD to borrow"
                        min={Math.ceil(toNum(minBorrow))}
                        max={Math.floor(toNum(maxBorrow))}
                        step={10}
                        value={Math.min(Math.floor(toNum(maxBorrow)), Math.max(Math.ceil(toNum(minBorrow)), borrow !== undefined ? Math.round(toNum(borrow)) : 0))}
                        onChange={(e) => setBorrow(e.target.value)}
                      />
                      <div className="ticks">
                        <span>{Math.ceil(toNum(minBorrow)).toLocaleString("en-US")} min</span>
                        <span>{num(maxBorrow, 0)} at the floor</span>
                      </div>
                    </>
                  )}
                  <div className="presets" aria-label="Pick a safety level">
                    {PRESETS.map((x) => (
                      <button key={x.name} type="button" disabled={coll === undefined} onClick={() => applyPreset(x.bps)}>
                        {x.name} · {x.bps / 100}%
                      </button>
                    ))}
                  </div>
                </div>
                <dl className="breakdown">
                  <div>
                    <dt>You borrow</dt>
                    <dd>{borrow !== undefined ? `${num(borrow)} MUSD` : "—"}</dd>
                  </div>
                  <div>
                    <dt>Mezo borrowing fee</dt>
                    <dd>{p ? `${num(p.fee)} MUSD` : "—"}</dd>
                  </div>
                  <div>
                    <dt>Gas deposit, refunded when you close</dt>
                    <dd>{gasComp !== undefined ? `${num(gasComp)} MUSD` : "—"}</dd>
                  </div>
                  <div className="tot">
                    <dt>Debt on the line</dt>
                    <dd>{p ? `${num(p.compositeDebt)} MUSD` : "—"}</dd>
                  </div>
                </dl>
                <p className={`note${err ? " err" : ""}`} aria-live="polite">
                  {err || (preview.error ? `Couldn't preview: ${(preview.error as Error).message}` : "")}
                </p>
                <button className="btn btn-orange" type="submit" disabled={!ready || tx.busy}>
                  Open the line
                </button>
              </form>
            </section>
          )}

          {step === 3 && (
            <section className="stage" aria-labelledby="s3-h">
              {opened ? (
                <div className="success" role="status">
                  <span className="ck" aria-hidden="true">
                    ✓
                  </span>
                  <span>
                    <b>Your line is open</b>
                    {num(opened.coll, 4)} BTC is locked and {num(opened.borrow, 0)} MUSD is in your vault, starting at a {ratio(opened.icrBps)} safety ratio.
                  </span>
                </div>
              ) : (
                <div className="success" role="status">
                  <span className="ck" aria-hidden="true">
                    ✓
                  </span>
                  <span>
                    <b>Your line is already open</b>
                    You can manage it on the Overview.
                  </span>
                </div>
              )}
              <p className="eyebrow">Step 3 of 3</p>
              <h2 id="s3-h">Add your first agent</h2>
              <p className="lead">Give an agent key a daily limit, a per-payment limit and an end date. The SDK does the rest: when the agent runs low it draws from the vault, and it pays x402 APIs in MUSD.</p>
              <div className="stage-acts">
                <a className="btn btn-orange" href={href("agents")}>
                  Add an agent →
                </a>
                <a className="btn btn-ghost" href={href("overview")}>
                  See it on the Overview
                </a>
              </div>
            </section>
          )}

          {step !== 3 && <Summary coll={coll} borrow={borrow} price={price ?? p?.price} p={p} floorBps={floorBps} />}
        </div>
      </div>

      <section className="howit" aria-labelledby="howit-h">
        <h2 id="howit-h">What happens when you open it</h2>
        <ol>
          <li>
            <span className="hn">1</span>
            <b>Your BTC stays yours</b>
            <p>It's locked in a Mezo trove owned by your vault, not by BanQor.</p>
          </li>
          <li>
            <span className="hn">2</span>
            <b>MUSD waits in the vault</b>
            <p>Agents draw from it. When it runs low, the vault borrows a little more against your BTC.</p>
          </li>
          <li>
            <span className="hn">3</span>
            <b>{floorBps !== undefined ? `A ${floorBps / 100}% floor protects you` : "A floor protects you"}</b>
            <p>Below it, agent draws stop on their own. You can change it any time.</p>
          </li>
          <li>
            <span className="hn">4</span>
            <b>110% is the danger line</b>
            <p>There Mezo can liquidate the trove. Add BTC or repay before then.</p>
          </li>
        </ol>
      </section>
    </div>
  );
}

function Summary({ coll, borrow, price, p, floorBps }: { coll?: bigint; borrow?: bigint; price?: bigint; p?: Awaited<ReturnType<typeof previewOpenLine>>; floorBps?: number }) {
  const bad = !!p && floorBps !== undefined && p.icrBps < BigInt(floorBps);
  const drop = p && price ? ((1 - toNum(p.floorPrice) / toNum(price)) * 100).toFixed(0) : undefined;
  return (
    <section className="statement" aria-label="Summary of the line">
      <p className="lbl">Summary</p>
      <dl className="sumlist">
        <div>
          <dt>You lock</dt>
          <dd>
            {coll !== undefined ? (
              <>
                {formatUnits(coll, 18)} BTC{price !== undefined && <small>≈ {usd((coll * price) / E18)}</small>}
              </>
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div>
          <dt>Ready for your agents</dt>
          <dd>{borrow !== undefined ? `${num(borrow, 0)} MUSD` : "—"}</dd>
        </div>
        <div>
          <dt>You owe</dt>
          <dd>{p ? `${num(p.compositeDebt)} MUSD` : "—"}</dd>
        </div>
        <div className="hl">
          <dt>Safety ratio</dt>
          <dd className={bad ? "bad" : ""}>{p ? ratio(p.icrBps) : "—"}</dd>
        </div>
        <div>
          <dt>Agents pause if BTC is below</dt>
          <dd>{p ? usd(p.floorPrice) : "—"}</dd>
        </div>
        <div>
          <dt>Liquidation if BTC is below</dt>
          <dd>{p ? usd(p.liquidationPrice) : "—"}</dd>
        </div>
      </dl>
      {p && (
        <p className={`verdict${bad || !p.meetsMinDebt ? " bad" : ""}`}>
          {!p.meetsMinDebt
            ? "Below Mezo's minimum loan, so it can't open yet."
            : bad
              ? `Below the ${floorBps! / 100}% floor, so the vault won't open this.`
              : `Safe to open. BTC can drop ${drop}% before agents pause.`}
        </p>
      )}
    </section>
  );
}
