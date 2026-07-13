import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, CircleHelp, RotateCcw, Save, Trash2, Volume2 } from "lucide-react";
import "./CrapsSim.css";

const STARTING_BALANCE = 1000;
const CHIP_VALUES = [1, 5, 25, 100];
const POINTS = [4, 5, 6, 8, 9, 10];
const DIE_ENTROPY = new Uint32Array(1024);
const DIE_SAMPLE_LIMIT = Math.floor(0x100000000 / 6) * 6;
let dieEntropyIndex = DIE_ENTROPY.length;

function rollFairDie() {
  while (true) {
    if (dieEntropyIndex >= DIE_ENTROPY.length) {
      globalThis.crypto.getRandomValues(DIE_ENTROPY);
      dieEntropyIndex = 0;
    }
    const sample = DIE_ENTROPY[dieEntropyIndex++];
    if (sample < DIE_SAMPLE_LIMIT) return (sample % 6) + 1;
  }
}

const BETS = {
  pass: { label: "Pass line", payout: "1:1", family: "line" },
  dontPass: { label: "Don't pass", payout: "1:1 · 12 pushes", family: "line" },
  come: { label: "Come", payout: "1:1", family: "line" },
  dontCome: { label: "Don't come", payout: "1:1 · 12 pushes", family: "line" },
  passOdds: { label: "Pass odds", payout: "2:1 · 3:2 · 6:5", family: "odds" },
  dontPassOdds: { label: "Don't pass odds", payout: "1:2 · 2:3 · 5:6", family: "odds" },
  field: { label: "Field", payout: "1:1 · 2 pays 2:1 · 12 pays 3:1", family: "one" },
  anySeven: { label: "Any 7", payout: "4:1", family: "one" },
  anyCraps: { label: "Any craps", payout: "7:1", family: "one" },
  eleven: { label: "Yo 11", payout: "15:1", family: "one" },
  two: { label: "Aces 2", payout: "30:1", family: "one" },
  three: { label: "Ace-deuce 3", payout: "15:1", family: "one" },
  twelve: { label: "Boxcars 12", payout: "30:1", family: "one" },
  horn: { label: "Horn 2·3·11·12", payout: "27:4 / 3:1", family: "one" },
  world: { label: "World 2·3·11·12 + 7", payout: "varies", family: "one" },
  ce: { label: "C & E", payout: "11 pays 7:1 · craps pays 3:1", family: "one" },
  big6: { label: "Big 6", payout: "1:1", family: "multi" },
  big8: { label: "Big 8", payout: "1:1", family: "multi" },
  hard4: { label: "Hard 4", payout: "7:1", family: "hard", number: 4 },
  hard6: { label: "Hard 6", payout: "9:1", family: "hard", number: 6 },
  hard8: { label: "Hard 8", payout: "9:1", family: "hard", number: 8 },
  hard10: { label: "Hard 10", payout: "7:1", family: "hard", number: 10 },
};

POINTS.forEach((n) => {
  BETS[`place${n}`] = { label: `Place ${n}`, payout: n === 6 || n === 8 ? "7:6" : n === 5 || n === 9 ? "7:5" : "9:5", family: "place", number: n };
  BETS[`buy${n}`] = { label: `Buy ${n}`, payout: n === 4 || n === 10 ? "2:1" : n === 5 || n === 9 ? "3:2" : "6:5", family: "buy", number: n };
  BETS[`lay${n}`] = { label: `Lay ${n}`, payout: n === 4 || n === 10 ? "1:2" : n === 5 || n === 9 ? "2:3" : "5:6", family: "lay", number: n };
  BETS[`come${n}`] = { label: `Come ${n}`, payout: "1:1", family: "comePoint", number: n };
  BETS[`dontCome${n}`] = { label: `Don't Come ${n}`, payout: "1:1", family: "dontComePoint", number: n };
  BETS[`comeOdds${n}`] = { label: `Come ${n} odds`, payout: n === 4 || n === 10 ? "2:1" : n === 5 || n === 9 ? "3:2" : "6:5", family: "comeOdds", number: n };
  BETS[`dontComeOdds${n}`] = { label: `Don't Come ${n} odds`, payout: n === 4 || n === 10 ? "1:2" : n === 5 || n === 9 ? "2:3" : "5:6", family: "dontComeOdds", number: n };
});

const money = (n) => `$${Math.abs(n).toFixed(0)}`;
const ratioProfit = (amount, ratio) => amount * ratio;
const isStrategyBet = (id) => BETS[id] && !["odds", "comePoint", "dontComePoint", "comeOdds", "dontComeOdds"].includes(BETS[id].family);
const canRebuyMidRound = (id) => ["place", "buy", "lay", "hard", "multi", "one"].includes(BETS[id]?.family) || id === "come" || id === "dontCome";
const shuffle = (items) => [...items].sort(() => Math.random() - 0.5);
const generateAgentBets = () => {
  const excluded = new Set([Math.random()<.5?"pass":"dontPass",Math.random()<.5?"come":"dontCome"]);
  const candidates=shuffle(Object.keys(BETS).filter((id)=>isStrategyBet(id)&&!excluded.has(id)));
  const count=1+Math.floor(Math.random()*candidates.length);
  let remaining=STARTING_BALANCE;
  return Object.fromEntries(candidates.slice(0,count).map((id,index)=>{
    const minimumForRest=(count-index-1)*5;
    const maxUnits=Math.max(1,Math.min(20,Math.floor((remaining-minimumForRest)/5)));
    const amount=5*(1+Math.floor(Math.random()*maxUnits));
    remaining-=amount;
    return [id,amount];
  }));
};
const generateAgentRebuy=(bets)=>Object.fromEntries(Object.keys(bets).filter((id)=>canRebuyMidRound(id)&&Math.random()<.5).map((id)=>[id,true]));
const generateAgentStrategy=()=>{const bets=generateAgentBets();return {bets,rebuy:generateAgentRebuy(bets)};};
const FIRST_NAMES=["Ada","Maya","Nora","Iris","Lena","Ruby","Theo","Miles","Felix","Oscar","Eli","Leo","June","Cleo","Zoe","Arlo","Jude","Max","Eve","Sage"];
const LAST_NAMES=["Bennett","Carter","Hayes","Morgan","Reed","Brooks","Parker","Quinn","Foster","Ellis","Price","Stone","Wells","Cole","Blake","Flynn","Shaw","Grant","Lane","Cross"];
const randomAgentName=()=>`${FIRST_NAMES[Math.floor(Math.random()*FIRST_NAMES.length)]} ${LAST_NAMES[Math.floor(Math.random()*LAST_NAMES.length)]}`;
const normalizeAgentBets=(input)=>{
  const bets=Object.fromEntries(Object.entries(input).filter(([id,amount])=>isStrategyBet(id)&&amount>=5).map(([id,amount])=>[id,Math.max(5,Math.round(amount/5)*5)]));
  if(bets.pass&&bets.dontPass) delete bets[Math.random()<.5?"pass":"dontPass"];
  if(bets.come&&bets.dontCome) delete bets[Math.random()<.5?"come":"dontCome"];
  let remaining=STARTING_BALANCE;
  const funded={};
  shuffle(Object.entries(bets)).forEach(([id,amount])=>{const value=Math.min(amount,Math.floor(remaining/5)*5);if(value>=5){funded[id]=value;remaining-=value;}});
  return Object.keys(funded).length?funded:{pass:5};
};
const mutateAgentBets=(source)=>{
  const bets={...source};
  const ids=Object.keys(bets);
  const allIds=Object.keys(BETS).filter(isStrategyBet);
  const action=Math.floor(Math.random()*3);
  if(action===0&&ids.length>1) delete bets[ids[Math.floor(Math.random()*ids.length)]];
  else if(action===1){const id=allIds[Math.floor(Math.random()*allIds.length)];bets[id]=5*(1+Math.floor(Math.random()*20));}
  else {const id=ids[Math.floor(Math.random()*ids.length)];bets[id]=Math.max(5,(bets[id]||5)+(Math.random()<.5?-5:5));}
  return normalizeAgentBets(bets);
};
const breedAgentStrategy=(parentA,parentB,mutationChance)=>{
  const child={};
  const genes=new Set([...Object.keys(parentA.bets),...Object.keys(parentB.bets)]);
  genes.forEach((id)=>{const source=Math.random()<.5?parentA.bets:parentB.bets;if(source[id]&&Math.random()<.82)child[id]=source[id];});
  let normalized=normalizeAgentBets(child);
  const rebuy={};
  Object.keys(normalized).filter(canRebuyMidRound).forEach((id)=>{
    const source=Math.random()<.5?parentA:parentB;
    if(source.rebuy?.[id])rebuy[id]=true;
  });
  if(Math.random()*100<mutationChance){
    if(Math.random()<.5) normalized=mutateAgentBets(normalized);
    else {
      const eligible=Object.keys(normalized).filter(canRebuyMidRound);
      if(eligible.length){const id=eligible[Math.floor(Math.random()*eligible.length)];if(rebuy[id])delete rebuy[id];else rebuy[id]=true;}
    }
  }
  Object.keys(rebuy).forEach((id)=>{if(!normalized[id])delete rebuy[id];});
  return {bets:normalized,rebuy};
};

function Chip({ amount, small = false }) {
  return <span className={`cs-chip cs-chip-${amount <= 1 ? 1 : amount <= 5 ? 5 : amount <= 25 ? 25 : 100} ${small ? "small" : ""}`}>${money(amount)}</span>;
}

function BetSpot({ id, bets, onBet, className = "", children }) {
  const amount = bets[id] || 0;
  return (
    <button className={`bet-spot ${className} ${amount ? "has-bet" : ""}`} onClick={() => onBet(id)} title={`${BETS[id].label} — ${BETS[id].payout}`}>
      {children || <><strong>{BETS[id].label}</strong><small>PAYS {BETS[id].payout}</small></>}
      {amount > 0 && <Chip amount={amount} small />}
    </button>
  );
}

function Die({ value, rolling }) {
  const pipMap = { 1:[5], 2:[1,9], 3:[1,5,9], 4:[1,3,7,9], 5:[1,3,5,7,9], 6:[1,3,4,6,7,9] };
  return <div className={`die ${rolling ? "rolling" : ""}`}>{Array.from({length:9},(_,i)=><i key={i} className={pipMap[value].includes(i+1) ? "on" : ""}/>)}</div>;
}

export default function CrapsSim() {
  const [balance, setBalance] = useState(STARTING_BALANCE);
  const [bets, setBets] = useState({});
  const [chip, setChip] = useState(5);
  const [dice, setDice] = useState([3, 4]);
  const [point, setPoint] = useState(null);
  const [rolling, setRolling] = useState(false);
  const [history, setHistory] = useState([]);
  const [rollCount, setRollCount] = useState(100);
  const [simulating, setSimulating] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState("table");
  const [trialStrategyId, setTrialStrategyId] = useState("");
  const [trialCount, setTrialCount] = useState(100);
  const [trialRolls, setTrialRolls] = useState(500);
  const [trialsRunning, setTrialsRunning] = useState(false);
  const [trialResults, setTrialResults] = useState(null);
  const [trialHistory, setTrialHistory] = useState([]);
  const [trialHistoryExpanded, setTrialHistoryExpanded] = useState(false);
  const [agentName, setAgentName] = useState("");
  const [agents, setAgents] = useState(() => {
    try { return JSON.parse(localStorage.getItem("craps-strategy-agents") || "[]"); } catch { return []; }
  });
  const [evolutionGenerations,setEvolutionGenerations]=useState(10);
  const [evolutionPopulation,setEvolutionPopulation]=useState(20);
  const [evolutionTrials,setEvolutionTrials]=useState(25);
  const [evolutionRolls,setEvolutionRolls]=useState(250);
  const [evolutionThreshold,setEvolutionThreshold]=useState(50);
  const [evolutionMutation,setEvolutionMutation]=useState(10);
  const [evolutionRunning,setEvolutionRunning]=useState(false);
  const [evolutionProgress,setEvolutionProgress]=useState(null);
  const [evolutionResults,setEvolutionResults]=useState(null);
  const [evolutionError,setEvolutionError]=useState("");
  const [savedEvolutionAgents,setSavedEvolutionAgents]=useState({});
  const [message, setMessage] = useState("Place a Pass or Don't Pass bet, then roll.");
  const [betMode, setBetMode] = useState("place");
  const [strategies, setStrategies] = useState(() => {
    try { return JSON.parse(localStorage.getItem("craps-strategies") || "[]"); } catch { return []; }
  });
  const [strategyName, setStrategyName] = useState("");
  const [draftRebuy, setDraftRebuy] = useState({});
  const [activeStrategyId, setActiveStrategyId] = useState(null);
  const [strategyEnabled, setStrategyEnabled] = useState(false);
  const wagered = useMemo(() => Object.values(bets).reduce((a,b)=>a+b,0), [bets]);
  const activeStrategy = strategies.find((s) => s.id === activeStrategyId) || null;
  const betsRef = useRef(bets);
  const balanceRef = useRef(balance);
  const pointRef = useRef(point);

  useEffect(() => { localStorage.setItem("craps-strategies", JSON.stringify(strategies)); }, [strategies]);
  useEffect(() => { localStorage.setItem("craps-strategy-agents", JSON.stringify(agents)); }, [agents]);
  useEffect(() => { betsRef.current = bets; }, [bets]);
  useEffect(() => { balanceRef.current = balance; }, [balance]);
  useEffect(() => { pointRef.current = point; }, [point]);

  const saveStrategy = () => {
    const templateBets = Object.fromEntries(Object.entries(bets).filter(([id, amount]) => amount > 0 && isStrategyBet(id)));
    if (!strategyName.trim()) { setMessage("Give your strategy a name before saving it."); return; }
    if (!Object.keys(templateBets).length) { setMessage("Place at least one reusable bet before saving a strategy."); return; }
    const strategy = { id: crypto.randomUUID(), name: strategyName.trim(), bets: templateBets, rebuy: Object.fromEntries(Object.keys(templateBets).filter((id) => draftRebuy[id]).map((id) => [id, true])) };
    setStrategies((items) => [...items, strategy]);
    setActiveStrategyId(strategy.id); setStrategyEnabled(true); setStrategyName(""); setDraftRebuy({});
    setMessage(`Strategy “${strategy.name}” saved and activated.`);
  };

  const updateRebuy = (id, checked) => {
    setStrategies((items) => items.map((s) => s.id === activeStrategyId ? { ...s, rebuy: { ...s.rebuy, [id]: checked } } : s));
  };

  const enactStrategyNow = (strategy) => {
    if (!strategy) return;
    let available = balance;
    const additions = {};
    Object.entries(strategy.bets).forEach(([id, target]) => {
      if ((id === "pass" || id === "dontPass") && point) return;
      if ((id === "come" || id === "dontCome") && !point) return;
      const needed = Math.max(0, target - (bets[id] || 0));
      const amount = Math.min(needed, available);
      if (amount > 0) { additions[id] = amount; available -= amount; }
    });
    const spent = Object.values(additions).reduce((sum, amount) => sum + amount, 0);
    if (spent) { setBets((current) => ({ ...current, ...Object.fromEntries(Object.entries(additions).map(([id, amount]) => [id, (current[id] || 0) + amount])) })); setBalance((current) => current - spent); }
    setMessage(`Strategy “${strategy.name}” activated${spent ? ` with ${money(spent)} placed` : ""}.`);
  };

  const deleteStrategy = () => {
    if (!activeStrategy) return;
    setStrategies((items) => items.filter((s) => s.id !== activeStrategy.id));
    setActiveStrategyId(null); setStrategyEnabled(false);
    setMessage(`Strategy “${activeStrategy.name}” deleted.`);
  };

  const createAgent = () => {
    const name=agentName.trim();
    if(!name)return;
    setAgents((items)=>[...items,{id:crypto.randomUUID(),name,...generateAgentStrategy(),savedStrategyId:null}]);
    setAgentName("");
  };

  const updateAgent = (id, changes) => setAgents((items)=>items.map((agent)=>agent.id===id?{...agent,...changes}:agent));
  const saveAgentStrategy = (agent) => {
    if(agent.savedStrategyId && strategies.some((strategy)=>strategy.id===agent.savedStrategyId)){
      setStrategies((items)=>items.map((strategy)=>strategy.id===agent.savedStrategyId?{...strategy,name:agent.name,bets:agent.bets,rebuy:agent.rebuy||{}}:strategy));
    } else {
      const strategyId=crypto.randomUUID();
      setStrategies((items)=>[...items,{id:strategyId,name:agent.name,bets:agent.bets,rebuy:agent.rebuy||{},agentId:agent.id}]);
      updateAgent(agent.id,{savedStrategyId:strategyId});
    }
  };

  const placeBet = (id) => {
    if (rolling || balance < chip) return;
    if ((id === "pass" || id === "dontPass") && point) { setMessage("Line bets may only be placed on the come-out roll."); return; }
    if ((id === "come" || id === "dontCome") && !point) { setMessage("Come bets open after a point is established."); return; }
    if ((id === "passOdds" || id === "dontPassOdds") && (!point || !bets[id === "passOdds" ? "pass" : "dontPass"])) { setMessage("Odds require a point and the matching line bet."); return; }
    const comeOddsMatch = id.match(/^(dontCome|come)Odds(4|5|6|8|9|10)$/);
    if (comeOddsMatch) {
      const [, kind, numberText] = comeOddsMatch;
      const n = Number(numberText);
      const baseId = `${kind}${n}`;
      if (!bets[baseId]) { setMessage("A Come Point must be established before adding odds."); return; }
      const maxMultiple = kind === "come" ? (n === 4 || n === 10 ? 3 : n === 5 || n === 9 ? 4 : 5) : 6;
      if ((bets[id] || 0) + chip > bets[baseId] * maxMultiple) { setMessage(`${BETS[id].label} are capped at ${maxMultiple}x the flat bet.`); return; }
    }
    setBets((b) => ({ ...b, [id]: (b[id] || 0) + chip }));
    setBalance((n) => n - chip);
    setMessage(`${money(chip)} on ${BETS[id].label}.`);
  };

  const clearBets = () => {
    setBalance((n) => n + wagered);
    setBets({});
    setMessage("Bets returned to your rack.");
  };

  const settle = (d1, d2, options = {}) => {
    const { silent = false, strategyOverride = activeStrategy, strategyOn = strategyEnabled } = options;
    const bets = betsRef.current;
    const balance = balanceRef.current;
    const point = pointRef.current;
    const amountAtRisk = Object.values(bets).reduce((sum, amount) => sum + amount, 0);
    const total = d1 + d2;
    const hard = d1 === d2;
    let returned = 0;
    let net = 0;
    const next = {};
    const wins = [];
    const losses = [];
    const pay = (id, profit, keep=false) => { const a=bets[id]||0; if(!a)return; returned += profit + (keep ? 0 : a); net += profit; wins.push(BETS[id].label); if(keep) next[id]=a; };
    const lose = (id) => { const a=bets[id]||0; if(!a)return; net -= a; losses.push(BETS[id].label); };
    const push = (id) => { const a=bets[id]||0; if(a){returned+=a; wins.push(`${BETS[id].label} push`);} };
    const hold = (id) => { if(bets[id]) next[id]=bets[id]; };
    const move = (from, to) => { const a=bets[from]||0; if(a){ next[to]=(next[to]||0)+a; wins.push(`${BETS[from].label} moved to ${total}`); } };

    // One-roll proposition bets.
    const oneRules = {
      field: [ [2,3,4,9,10,11,12].includes(total), total===2?2:total===12?3:1 ],
      anySeven: [total===7,4], anyCraps:[[2,3,12].includes(total),7], eleven:[total===11,15],
      two:[total===2,30], three:[total===3,15], twelve:[total===12,30],
      ce:[[2,3,11,12].includes(total), total===11?7:3],
      horn:[[2,3,11,12].includes(total), (total===2||total===12)?6.75:3],
      world:[[2,3,7,11,12].includes(total), total===7?0:(total===2||total===12)?5.4:2.4],
    };
    Object.entries(oneRules).forEach(([id,[win,ratio]]) => win ? pay(id, ratioProfit(bets[id]||0,ratio)) : lose(id));

    // Hardways stay up on unrelated rolls.
    [4,6,8,10].forEach((n)=>{ const id=`hard${n}`; if(total===n) hard ? pay(id,ratioProfit(bets[id]||0,n===4||n===10?7:9),true) : lose(id); else if(total===7) lose(id); else hold(id); });
    // Place, buy and lay numbers; buy/lay use a 5% commission on winnings.
    POINTS.forEach((n)=>{
      const place=`place${n}`, buy=`buy${n}`, lay=`lay${n}`;
      const placeRatio=n===6||n===8?7/6:n===5||n===9?7/5:9/5;
      const buyRatio=n===4||n===10?2:n===5||n===9?1.5:1.2;
      const layRatio=n===4||n===10?.5:n===5||n===9?2/3:5/6;
      if(total===n){ pay(place,ratioProfit(bets[place]||0,placeRatio),true); pay(buy,ratioProfit(bets[buy]||0,buyRatio*.95),true); lose(lay); }
      else if(total===7){ lose(place); lose(buy); pay(lay,ratioProfit(bets[lay]||0,layRatio*.95),true); }
      else { hold(place); hold(buy); hold(lay); }
    });
    // Big 6/8.
    [6,8].forEach(n=>{const id=`big${n}`; if(total===n)pay(id,bets[id]||0,true); else if(total===7)lose(id); else hold(id);});

    // Established Come and Don't Come contracts travel independently of the table point.
    POINTS.forEach((n) => {
      const comeId=`come${n}`, dontId=`dontCome${n}`, comeOddsId=`comeOdds${n}`, dontOddsId=`dontComeOdds${n}`;
      const comeOddsRatio=n===4||n===10?2:n===5||n===9?1.5:1.2;
      const dontOddsRatio=n===4||n===10?.5:n===5||n===9?2/3:5/6;
      if(total===n){
        pay(comeId,bets[comeId]||0); pay(comeOddsId,ratioProfit(bets[comeOddsId]||0,comeOddsRatio));
        lose(dontId); lose(dontOddsId);
      } else if(total===7){
        lose(comeId); lose(comeOddsId);
        pay(dontId,bets[dontId]||0); pay(dontOddsId,ratioProfit(bets[dontOddsId]||0,dontOddsRatio));
      } else { hold(comeId); hold(dontId); hold(comeOddsId); hold(dontOddsId); }
    });

    let nextPoint = point;
    if (!point) {
      if ([7,11].includes(total)) { pay("pass", bets.pass||0); lose("dontPass"); }
      else if ([2,3,12].includes(total)) { lose("pass"); total===12?push("dontPass"):pay("dontPass",bets.dontPass||0); }
      else { nextPoint=total; hold("pass"); hold("dontPass"); }
    } else {
      // Bets in the COME / DON'T COME boxes get exactly one come-out roll, then travel.
      if([7,11].includes(total)){ pay("come",bets.come||0); lose("dontCome"); }
      else if([2,3,12].includes(total)){ lose("come"); total===12?push("dontCome"):pay("dontCome",bets.dontCome||0); }
      else { move("come",`come${total}`); move("dontCome",`dontCome${total}`); }
      const oddsFor = point===4||point===10?2:point===5||point===9?1.5:1.2;
      const layOddsFor = point===4||point===10?.5:point===5||point===9?2/3:5/6;
      if(total===point){ pay("pass",bets.pass||0); pay("passOdds",ratioProfit(bets.passOdds||0,oddsFor)); lose("dontPass"); lose("dontPassOdds"); nextPoint=null; }
      else if(total===7){ lose("pass"); lose("passOdds"); pay("dontPass",bets.dontPass||0); pay("dontPassOdds",ratioProfit(bets.dontPassOdds||0,layOddsFor)); nextPoint=null; }
      else { hold("pass"); hold("dontPass"); hold("passOdds"); hold("dontPassOdds"); }
    }
    let autoSpent = 0;
    const autoAdded = [];
    if (strategyOn && strategyOverride) {
      const roundReset = nextPoint === null && ((!point && [2,3,7,11,12].includes(total)) || (point && (total === point || total === 7)));
      const pointStarted = !point && nextPoint !== null;
      let available = balance + returned;
      Object.entries(strategyOverride.bets).forEach(([id, target]) => {
        const legal = id !== "come" && id !== "dontCome" ? true : Boolean(nextPoint);
        const shouldRestore = roundReset
          ? id !== "come" && id !== "dontCome"
          : pointStarted
            ? id === "come" || id === "dontCome" || Boolean(strategyOverride.rebuy?.[id])
            : Boolean(strategyOverride.rebuy?.[id]);
        if (!legal || !shouldRestore) return;
        const needed = Math.max(0, target - (next[id] || 0));
        const amount = Math.min(needed, available);
        if (amount > 0) { next[id] = (next[id] || 0) + amount; available -= amount; autoSpent += amount; autoAdded.push(BETS[id].label); }
      });
    }
    const resultingBalance = balance + returned - autoSpent;
    balanceRef.current = resultingBalance;
    betsRef.current = next;
    pointRef.current = nextPoint;
    if (!silent) {
      setBalance(resultingBalance);
      setBets(next);
      setPoint(nextPoint);
    }
    const status = nextPoint && !point ? `Point is ${nextPoint}.` : total===7 && point ? "Seven out! New come-out roll." : total===point && point ? `${point} made! New come-out roll.` : `${total} rolled.`;
    if (!silent) setMessage(`${status}${wins.length?` Won: ${wins.join(", ")}.`:""}${losses.length?` Lost: ${losses.join(", ")}.`:""}${autoAdded.length?` Strategy replaced: ${autoAdded.join(", ")}.`:""}`);
    const record = { id:`${Date.now()}-${Math.random()}`, dice:`${d1} + ${d2}`, diceValues:[d1,d2], total, net, balance:resultingBalance, balanceImpact:returned-autoSpent, moneyIn:amountAtRisk, moneyOut:returned, newWagers:autoSpent, pointBefore:point, pointAfter:nextPoint, status };
    if (!silent) setHistory((h)=>[record,...h]);
    return { bankrupt: resultingBalance <= 0 && Object.values(next).reduce((sum, amount)=>sum+amount,0) <= 0, record };
  };

  const roll = () => {
    if(rolling || simulating)return;
    setRolling(true); setMessage("Dice out!");
    setTimeout(()=>{ const d1=rollFairDie(), d2=rollFairDie(); setDice([d1,d2]); settle(d1,d2); setRolling(false); },650);
  };

  const runSimulation = async () => {
    const count = Math.max(1, Math.min(10000, Math.floor(Number(rollCount) || 1)));
    setRollCount(count); setSimulating(true); setMessage(`Fast rolling ${count.toLocaleString()} rolls…`);
    let completed = 0;
    let bankrupt = false;
    for (let i=0; i<count; i+=1) {
      const d1=rollFairDie(), d2=rollFairDie();
      setDice([d1,d2]);
      const result=settle(d1,d2); completed+=1;
      if(result.bankrupt){bankrupt=true;break;}
      if((i+1)%25===0) await new Promise((resolve)=>setTimeout(resolve,0));
    }
    setSimulating(false);
    setMessage(bankrupt ? `Bankrupt after ${completed.toLocaleString()} simulated rolls. No cash or active wagers remain.` : `Simulation complete: ${completed.toLocaleString()} rolls.`);
  };

  const runTrials = async () => {
    const strategy = strategies.find((item) => item.id === trialStrategyId);
    if (!strategy) return;
    const rolls = Math.max(1, Math.min(10000, Math.floor(Number(trialRolls) || 1)));
    const requestedTrials = Math.max(1, Math.min(5000, Math.floor(Number(trialCount) || 1)));
    const trials = Math.min(requestedTrials, Math.max(1, Math.floor(2000000 / rolls)));
    setTrialCount(trials); setTrialRolls(rolls); setTrialsRunning(true); setTrialResults(null);
    const liveState = { bets:betsRef.current, balance:balanceRef.current, point:pointRef.current };
    const endings = [];
    const completedTrials = [];
    let bankruptcies = 0;
    const runId = Date.now();
    for (let trial=0; trial<trials; trial+=1) {
      let available = STARTING_BALANCE;
      const openingBets = {};
      Object.entries(strategy.bets).forEach(([id,target]) => {
        if (id === "come" || id === "dontCome") return;
        const amount=Math.min(target,available);
        if(amount>0){openingBets[id]=amount;available-=amount;}
      });
      betsRef.current=openingBets; balanceRef.current=available; pointRef.current=null;
      let bankrupt=false;
      let rollsCompleted=0;
      for(let rollIndex=0;rollIndex<rolls;rollIndex+=1){
        const d1=rollFairDie(), d2=rollFairDie();
        const result=settle(d1,d2,{silent:true,strategyOverride:strategy,strategyOn:true});
        rollsCompleted+=1;
        if(result.bankrupt){bankrupt=true;break;}
      }
      if(bankrupt) bankruptcies+=1;
      const endingBankroll=balanceRef.current+Object.values(betsRef.current).reduce((sum,amount)=>sum+amount,0);
      endings.push(endingBankroll);
      completedTrials.push({id:`${runId}-${trial}`,runId,trialNumber:trial+1,strategyName:strategy.name,rollsPlanned:rolls,rollsCompleted,endingBankroll,impact:endingBankroll-STARTING_BALANCE,bankrupt,endingPoint:pointRef.current,endingCash:balanceRef.current,activeWagers:Object.values(betsRef.current).reduce((sum,amount)=>sum+amount,0)});
      if((trial+1)%20===0) await new Promise((resolve)=>setTimeout(resolve,0));
    }
    betsRef.current=liveState.bets; balanceRef.current=liveState.balance; pointRef.current=liveState.point;
    const sorted=[...endings].sort((a,b)=>a-b);
    const mean=endings.reduce((sum,value)=>sum+value,0)/endings.length;
    const variance=endings.reduce((sum,value)=>sum+(value-mean)**2,0)/endings.length;
    const middle=Math.floor(sorted.length/2);
    const median=sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;
    const profits=endings.filter((value)=>value>STARTING_BALANCE).length;
    const losses=endings.filter((value)=>value<STARTING_BALANCE).length;
    const stdDev=Math.sqrt(variance);
    const fitness=(sorted.at(-1)+(mean-STARTING_BALANCE)-stdDev)*(profits/trials);
    setTrialResults({trials,rolls,max:sorted.at(-1),min:sorted[0],bankruptcies,profits,losses,stdDev,mean,median,fitness});
    setTrialHistory((history)=>[...completedTrials.reverse(),...history]);
    setTrialsRunning(false);
  };

  const evaluateEvolutionAgent = (agent,trials,rolls) => {
    const endings=[];
    let bankruptcies=0;
    for(let trial=0;trial<trials;trial+=1){
      let available=STARTING_BALANCE;
      const opening={};
      Object.entries(agent.bets).forEach(([id,target])=>{if(id==="come"||id==="dontCome")return;const amount=Math.min(target,available);if(amount>=5){opening[id]=amount;available-=amount;}});
      betsRef.current=opening;balanceRef.current=available;pointRef.current=null;
      let bankrupt=false;
      for(let rollIndex=0;rollIndex<rolls;rollIndex+=1){
        const result=settle(rollFairDie(),rollFairDie(),{silent:true,strategyOverride:agent,strategyOn:true});
        if(result.bankrupt){bankrupt=true;break;}
      }
      if(bankrupt)bankruptcies+=1;
      endings.push(balanceRef.current+Object.values(betsRef.current).reduce((sum,amount)=>sum+amount,0));
    }
    const sorted=[...endings].sort((a,b)=>a-b);
    const mean=endings.reduce((sum,value)=>sum+value,0)/trials;
    const variance=endings.reduce((sum,value)=>sum+(value-mean)**2,0)/trials;
    const stdDev=Math.sqrt(variance);
    const profits=endings.filter((value)=>value>STARTING_BALANCE).length;
    const losses=endings.filter((value)=>value<STARTING_BALANCE).length;
    const middle=Math.floor(trials/2);
    const median=trials%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;
    const fitness=(sorted.at(-1)+(mean-STARTING_BALANCE)-stdDev)*(profits/trials);
    return {max:sorted.at(-1),min:sorted[0],mean,median,stdDev,profits,losses,bankruptcies,fitness};
  };

  const runEvolution = async () => {
    const generations=Math.max(1,Math.min(50,Math.floor(Number(evolutionGenerations)||1)));
    const populationSize=Math.max(2,Math.min(100,Math.floor(Number(evolutionPopulation)||2)));
    const trials=Math.max(1,Math.min(500,Math.floor(Number(evolutionTrials)||1)));
    const rolls=Math.max(1,Math.min(5000,Math.floor(Number(evolutionRolls)||1)));
    const threshold=Math.max(10,Math.min(90,Number(evolutionThreshold)||50));
    const mutation=Math.max(0,Math.min(100,Number(evolutionMutation)||0));
    const totalRolls=generations*populationSize*trials*rolls;
    if(totalRolls>10000000){setEvolutionError(`This configuration requests ${totalRolls.toLocaleString()} rolls. Reduce it to 10,000,000 or fewer.`);return;}
    setEvolutionError("");setEvolutionRunning(true);setEvolutionResults(null);setSavedEvolutionAgents({});
    const liveState={bets:betsRef.current,balance:balanceRef.current,point:pointRef.current};
    const usedNames=new Set();
    const uniqueName=()=>{let name=randomAgentName(),suffix=2;while(usedNames.has(name)){name=`${randomAgentName()} ${suffix++}`;}usedNames.add(name);return name;};
    let population=Array.from({length:populationSize},()=>({id:crypto.randomUUID(),name:uniqueName(),...generateAgentStrategy(),parents:null}));
    const generationHistory=[];
    for(let generation=1;generation<=generations;generation+=1){
      const evaluated=[];
      for(let index=0;index<population.length;index+=1){
        const agent=population[index];
        evaluated.push({...agent,generation,analytics:evaluateEvolutionAgent(agent,trials,rolls)});
        setEvolutionProgress({generation,generations,agent:index+1,population:populationSize});
        await new Promise((resolve)=>setTimeout(resolve,0));
      }
      evaluated.sort((a,b)=>b.analytics.fitness-a.analytics.fitness);
      generationHistory.push({generation,best:evaluated[0].analytics.fitness,mean:evaluated.reduce((sum,agent)=>sum+agent.analytics.fitness,0)/evaluated.length});
      if(generation===generations){population=evaluated;break;}
      const keepCount=Math.max(1,Math.ceil(populationSize*(threshold/100)));
      const survivors=evaluated.slice(0,keepCount);
      const next=survivors.map((agent)=>({...agent,analytics:undefined}));
      while(next.length<populationSize){
        const parentA=survivors[Math.floor(Math.random()*survivors.length)];
        const parentB=survivors[Math.floor(Math.random()*survivors.length)];
        next.push({id:crypto.randomUUID(),name:uniqueName(),...breedAgentStrategy(parentA,parentB,mutation),parents:[parentA.name,parentB.name]});
      }
      population=next;
    }
    betsRef.current=liveState.bets;balanceRef.current=liveState.balance;pointRef.current=liveState.point;
    setEvolutionResults({agents:population,generationHistory,config:{generations,populationSize,trials,rolls,threshold,mutation,totalRolls}});
    setEvolutionProgress(null);setEvolutionRunning(false);
  };

  const saveEvolutionAgent = (agent) => {
    if(savedEvolutionAgents[agent.id])return;
    const id=crypto.randomUUID();
    setStrategies((items)=>[...items,{id,name:agent.name,bets:agent.bets,rebuy:agent.rebuy||{},evolutionAgentId:agent.id}]);
    setSavedEvolutionAgents((saved)=>({...saved,[agent.id]:id}));
  };

  const reset = () => {
    const opening = strategyEnabled && activeStrategy
      ? Object.fromEntries(Object.entries(activeStrategy.bets).filter(([id]) => id !== "come" && id !== "dontCome"))
      : {};
    let available = STARTING_BALANCE;
    const funded = {};
    Object.entries(opening).forEach(([id, target]) => { const amount=Math.min(target,available); if(amount>0){funded[id]=amount;available-=amount;} });
    setBalance(available); setBets(funded); setDice([3,4]); setPoint(null); setHistory([]);
    setMessage(activeStrategy && strategyEnabled ? `Fresh table. Strategy “${activeStrategy.name}” placed.` : "Fresh table. Place your bets.");
  };

  return <main className="craps-page">
    <header className="cs-topbar">
      <div><span className="brand-mark">7</span><div><h1>THE FELT</h1><p>CRAPS SIMULATOR</p></div></div>
      <div className="cs-balance"><span>BALANCE</span><strong>{money(balance)}</strong><small>{money(wagered)} on table</small></div>
      <button className="icon-btn" onClick={reset} title="Reset game"><RotateCcw size={18}/></button>
    </header>

    <nav className="cs-tabs"><button className={activeTab==="table"?"active":""} onClick={()=>setActiveTab("table")}>TABLE</button><button className={activeTab==="trials"?"active":""} onClick={()=>setActiveTab("trials")}>TRIALS</button><button className={activeTab==="builder"?"active":""} onClick={()=>setActiveTab("builder")}>STRATEGY BUILDER</button><button className={activeTab==="evolution"?"active":""} onClick={()=>setActiveTab("evolution")}>EVOLUTION</button></nav>

    {activeTab === "table" ? <section className="cs-game">
      <div className="cs-table-shell">
        <div className="point-rail"><span className={!point?"active":""}>OFF</span>{POINTS.map(n=><span key={n} className={point===n?"active":""}>{n}</span>)}</div>
        <div className="craps-layout">
          <div className="number-row">
            {POINTS.map(n=><div className="number-column" key={n}>
              <b>{n}</b>
              <BetSpot id={`${betMode}${n}`} bets={bets} onBet={placeBet}><strong>{betMode.toUpperCase()}</strong><small>{BETS[`${betMode}${n}`].payout}</small></BetSpot>
              {(bets[`come${n}`]||0)>0 && <div className="travel-bet"><span>COME</span><Chip amount={bets[`come${n}`]} small/><BetSpot id={`comeOdds${n}`} bets={bets} onBet={placeBet}><small>ADD ODDS</small></BetSpot></div>}
              {(bets[`dontCome${n}`]||0)>0 && <div className="travel-bet dont"><span>DC</span><Chip amount={bets[`dontCome${n}`]} small/><BetSpot id={`dontComeOdds${n}`} bets={bets} onBet={placeBet}><small>LAY ODDS</small></BetSpot></div>}
            </div>)}
          </div>
          <div className="mode-tabs">{["place","buy","lay"].map(m=><button key={m} className={betMode===m?"active":""} onClick={()=>setBetMode(m)}>{m} numbers</button>)}</div>
          <div className="mid-grid">
            <BetSpot id="come" bets={bets} onBet={placeBet} className="come-spot" />
            <div className="field-area"><BetSpot id="field" bets={bets} onBet={placeBet}><small>2 PAYS 2:1</small><strong>FIELD</strong><div>2 · 3 · 4 · 9 · 10 · 11 · 12</div><small>12 PAYS 3:1</small></BetSpot></div>
            <div className="big-box"><BetSpot id="big6" bets={bets} onBet={placeBet}/><BetSpot id="big8" bets={bets} onBet={placeBet}/></div>
          </div>
          <BetSpot id="dontCome" bets={bets} onBet={placeBet} className="line-strip" />
          {point && <div className="odds-row"><BetSpot id="passOdds" bets={bets} onBet={placeBet}/><BetSpot id="dontPassOdds" bets={bets} onBet={placeBet}/></div>}
          <BetSpot id="dontPass" bets={bets} onBet={placeBet} className="line-strip dont" />
          <BetSpot id="pass" bets={bets} onBet={placeBet} className="line-strip pass" />
        </div>
        <div className="prop-layout">
          <div className="prop-title">PROPOSITION BETS <span>ONE ROLL UNLESS MARKED</span></div>
          <div className="prop-grid">{["two","three","anyCraps","eleven","twelve","anySeven","horn","world","ce"].map(id=><BetSpot key={id} id={id} bets={bets} onBet={placeBet}/>)}</div>
          <div className="hardways"><span>HARDWAYS</span>{[4,6,8,10].map(n=><BetSpot key={n} id={`hard${n}`} bets={bets} onBet={placeBet}/>)}</div>
        </div>
      </div>

      <aside className="cs-sidebar">
        <div className="dice-card">
          <div className="phase"><span className={point?"on":"off"}>{point?"POINT ON":"COME OUT"}</span>{point&&<b>{point}</b>}</div>
          <div className="dice-tray"><Die value={dice[0]} rolling={rolling}/><Die value={dice[1]} rolling={rolling}/><strong>{dice[0]+dice[1]}</strong></div>
          <button className="roll-button" onClick={roll} disabled={rolling || simulating || (!wagered && balance<=0)}>{rolling?"ROLLING…":simulating?"SIMULATING…":"ROLL DICE"}</button>
          <div className="fast-roll"><label><span>FAST SIMULATION</span><input type="number" min="1" max="10000" step="10" value={rollCount} disabled={simulating||rolling} onChange={(e)=>setRollCount(e.target.value)}/></label><button onClick={runSimulation} disabled={simulating||rolling}>{simulating?"RUNNING…":"RUN ROLLS"}</button><small>1–10,000 rolls. Stops automatically if bankrupt.</small></div>
          <p className="dealer-message"><Volume2 size={14}/>{message}</p>
        </div>
        <div className="bet-controls"><div className="card-heading"><span>CHIP VALUE</span><button onClick={clearBets} disabled={!wagered}><Trash2 size={14}/> Clear bets</button></div><div className="chips">{CHIP_VALUES.map(v=><button key={v} className={chip===v?"selected":""} onClick={()=>setChip(v)}><Chip amount={v}/></button>)}</div><p>Click any area on the felt to add a chip. Click repeatedly to increase a bet.</p></div>
        <div className="strategy-card">
          <div className="card-heading"><span>BETTING STRATEGY</span>{activeStrategy && <button onClick={deleteStrategy}><Trash2 size={14}/> Delete</button>}</div>
          {Object.entries(bets).some(([id,amount])=>amount>0&&isStrategyBet(id)) && <div className="draft-rebuy"><strong>BETS INCLUDED IN NEW STRATEGY</strong><p>Pass and Don’t Pass are automatically replaced on the next come-out roll. Other bets default to Next round only unless Always rebuy is enabled.</p>{Object.entries(bets).filter(([id,amount])=>amount>0&&isStrategyBet(id)).map(([id,amount])=><label key={id}><span>{BETS[id].label} <b>{money(amount)}</b></span>{canRebuyMidRound(id)?<span className="toggle-control"><small>{draftRebuy[id]?"Always rebuy":"Next round only"}</small><input type="checkbox" checked={Boolean(draftRebuy[id])} onChange={(e)=>setDraftRebuy((current)=>({...current,[id]:e.target.checked}))}/><i/><b>ALWAYS REBUY</b></span>:<small className="fixed-cycle">Next round only</small>}</label>)}</div>}
          <div className="strategy-save"><input value={strategyName} onChange={(e)=>setStrategyName(e.target.value)} placeholder="Name current bets…"/><button onClick={saveStrategy}><Save size={14}/> Save</button></div>
          {strategies.length > 0 && <div className="strategy-select"><select value={activeStrategyId || ""} onChange={(e)=>{const selected=strategies.find(s=>s.id===e.target.value)||null;setActiveStrategyId(selected?.id||null);setStrategyEnabled(Boolean(selected));if(selected)enactStrategyNow(selected);}}><option value="">Choose a strategy</option>{strategies.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select><label className="switch-label"><input type="checkbox" checked={strategyEnabled && Boolean(activeStrategy)} disabled={!activeStrategy} onChange={(e)=>{setStrategyEnabled(e.target.checked);if(e.target.checked)enactStrategyNow(activeStrategy);}}/><span/> AUTO</label></div>}
          {activeStrategy && <div className="strategy-bets"><strong>ACTIVE STRATEGY SETTINGS</strong>{Object.entries(activeStrategy.bets).map(([id,amount])=><div key={id}><span>{BETS[id].label} <b>{money(amount)}</b></span>{canRebuyMidRound(id)?<label className="toggle-control"><small>{activeStrategy.rebuy?.[id]?"Always rebuy":"Next round only"}</small><input type="checkbox" checked={Boolean(activeStrategy.rebuy?.[id])} onChange={(e)=>updateRebuy(id,e.target.checked)}/><i/><b>ALWAYS REBUY</b></label>:<small>Next round only</small>}</div>)}</div>}
          <p>Save the reusable bets currently on the felt, including Pass and Don’t Pass. Line bets return automatically for each new come-out roll; selected repeatable bets can also be rebought during a round.</p>
        </div>
        <div className={`history-card ${historyExpanded?"expanded":""}`}><div className="card-heading"><span>ROLL HISTORY</span><div><small>{history.length.toLocaleString()} rolls</small>{history.length>0&&<button className="expand-history" onClick={()=>setHistoryExpanded((open)=>!open)}>{historyExpanded?"Compact":"Expand"}</button>}</div></div>{!history.length?<div className="empty-history">Your results will appear here.</div>:<div className="history-list">{history.map((h,i)=><div className="history-entry" key={h.id}><div className="history-row"><span className="roll-num">#{history.length-i}</span><b>{h.dice} = {h.total}</b><span className={h.balanceImpact>0?"gain":h.balanceImpact<0?"loss":"push"}>{h.balanceImpact>0?"+":h.balanceImpact<0?"−":""}{money(h.balanceImpact)}</span><small>{money(h.balance)}</small></div>{historyExpanded&&<div className="history-detail"><span><b>Roll</b>{h.dice}</span><span><b>Balance impact</b>{h.balanceImpact>=0?"+":"−"}{money(h.balanceImpact)}</span><span><b>Money in / at risk</b>{money(h.moneyIn)}</span><span><b>Money out / paid</b>{money(h.moneyOut)}</span><span><b>New strategy bets</b>{money(h.newWagers)}</span><span><b>Point before</b>{h.pointBefore||"OFF"}</span><span><b>Point after</b>{h.pointAfter||"OFF"}</span><p>{h.status}</p></div>}</div>)}</div>}</div>
        <details className="rules-card"><summary><CircleHelp size={16}/> Quick rules & payouts <ChevronDown size={16}/></summary><p>On the come-out roll, Pass wins on 7/11 and loses on 2/3/12. Any other number sets the point. Make the point before a 7 to win. Place, buy, lay, hardway, field and proposition bets follow the payout printed on the felt. Buy and lay wins include a 5% commission.</p></details>
      </aside>
    </section> : activeTab === "trials" ? <section className="trials-page">
      <div className="trials-heading"><span>STRATEGY LAB</span><h2>Run independent trials</h2><p>Compare repeated outcomes without changing your live table, bankroll, dice, or roll history. Each trial starts with {money(STARTING_BALANCE)}.</p></div>
      <div className="trials-grid">
        <div className="trial-setup">
          <div className="card-heading"><span>SIMULATION SETUP</span></div>
          <label className="trial-field"><span>Saved strategy</span><select value={trialStrategyId} onChange={(e)=>{setTrialStrategyId(e.target.value);setTrialResults(null);}}><option value="">Select a strategy…</option>{strategies.map((strategy)=><option key={strategy.id} value={strategy.id}>{strategy.name}</option>)}</select></label>
          <div className="trial-counts"><label className="trial-field"><span>Number of trials</span><input type="number" min="1" max="5000" value={trialCount} onChange={(e)=>setTrialCount(e.target.value)}/></label><label className="trial-field"><span>Rolls per trial</span><input type="number" min="1" max="10000" value={trialRolls} onChange={(e)=>setTrialRolls(e.target.value)}/></label></div>
          <small className="trial-limit">Maximum 2,000,000 total simulated rolls per run.</small>
          <button className="run-trials" onClick={runTrials} disabled={!trialStrategyId||trialsRunning}>{trialsRunning?"RUNNING TRIALS…":"RUN SIMULATION"}</button>
        </div>
        <div className="trial-strategy">
          <div className="card-heading"><span>ACTIVE BETS IN STRATEGY</span></div>
          {!trialStrategyId?<div className="trial-empty">Select a saved strategy to inspect its wagers.</div>:<div className="trial-bet-list">{Object.entries(strategies.find((item)=>item.id===trialStrategyId)?.bets||{}).map(([id,amount])=><div key={id}><span>{BETS[id].label}<small>{BETS[id].payout}</small></span><b>{money(amount)}</b><em>{strategies.find((item)=>item.id===trialStrategyId)?.rebuy?.[id]?"Always rebuy":"Next round only"}</em></div>)}</div>}
        </div>
      </div>
      <div className="trial-analytics">
        <div className="analytics-title"><span>SIMULATION ANALYTICS</span>{trialResults&&<small>{trialResults.trials.toLocaleString()} trials × {trialResults.rolls.toLocaleString()} rolls</small>}</div>
        {!trialResults?<div className="trial-empty analytics-empty">Results will appear after the simulation completes.</div>:<div className="analytics-grid">
          <div><span>Max ending bankroll</span><strong>{money(trialResults.max)}</strong></div><div><span>Min ending bankroll</span><strong>{money(trialResults.min)}</strong></div>
          <div><span>Bankruptcies</span><strong>{trialResults.bankruptcies.toLocaleString()}</strong><small>{(trialResults.bankruptcies/trialResults.trials*100).toFixed(1)}%</small></div>
          <div><span>Profitable trials</span><strong>{trialResults.profits.toLocaleString()}</strong><small>{(trialResults.profits/trialResults.trials*100).toFixed(1)}%</small></div>
          <div><span>Losing trials</span><strong>{trialResults.losses.toLocaleString()}</strong><small>{(trialResults.losses/trialResults.trials*100).toFixed(1)}%</small></div>
          <div><span>Standard deviation</span><strong>{money(trialResults.stdDev)}</strong></div>
          <div><span>Mean ending bankroll</span><strong>{money(trialResults.mean)}</strong></div><div><span>Median ending bankroll</span><strong>{money(trialResults.median)}</strong></div>
          <div className="fitness-stat"><span>Fitness score <i className="fitness-help" tabIndex="0" aria-label="Fitness equals max ending bankroll plus mean ending bankroll minus initial bankroll, minus standard deviation, multiplied by profitable trials divided by total trials" data-tooltip={`Fitness = [max bankroll + (mean bankroll − initial bankroll) − standard deviation] × (profitable trials ÷ total trials). Current: [${trialResults.max.toFixed(2)} + (${trialResults.mean.toFixed(2)} − ${STARTING_BALANCE}) − ${trialResults.stdDev.toFixed(2)}] × (${trialResults.profits} ÷ ${trialResults.trials}).`}>?</i></span><strong>{trialResults.fitness.toFixed(2)}</strong></div>
        </div>}
      </div>
      <div className={`trial-history ${trialHistoryExpanded?"expanded":""}`}>
        <div className="analytics-title"><span>TRIAL HISTORY</span><div><small>{trialHistory.length.toLocaleString()} completed trials</small>{trialHistory.length>0&&<button className="expand-history" onClick={()=>setTrialHistoryExpanded((open)=>!open)}>{trialHistoryExpanded?"Compact":"Expand"}</button>}{trialHistory.length>0&&<button className="clear-trial-history" onClick={()=>setTrialHistory([])}>Clear</button>}</div></div>
        {!trialHistory.length?<div className="trial-empty">Completed trial summaries will appear here.</div>:<div className="trial-history-list">{trialHistory.map((trial)=><div className="trial-history-entry" key={trial.id}><div className="trial-history-row"><span>#{trial.trialNumber}</span><b>{trial.strategyName}</b><small>{trial.rollsCompleted.toLocaleString()} rolls</small><em className={trial.impact>0?"gain":trial.impact<0?"loss":"push"}>{trial.impact>0?"+":trial.impact<0?"−":""}{money(trial.impact)}</em><strong>{money(trial.endingBankroll)}</strong>{trial.bankrupt&&<i>BANKRUPT</i>}</div>{trialHistoryExpanded&&<div className="trial-history-detail"><span><b>Ending bankroll</b>{money(trial.endingBankroll)}</span><span><b>Net result</b>{trial.impact>=0?"+":"−"}{money(trial.impact)}</span><span><b>Rolls completed</b>{trial.rollsCompleted.toLocaleString()} / {trial.rollsPlanned.toLocaleString()}</span><span><b>Ending cash</b>{money(trial.endingCash)}</span><span><b>Active wagers</b>{money(trial.activeWagers)}</span><span><b>Ending point</b>{trial.endingPoint||"OFF"}</span><span><b>Status</b>{trial.bankrupt?"Bankrupt":trial.impact>0?"Profit":trial.impact<0?"Loss":"Break-even"}</span></div>}</div>)}</div>}
      </div>
    </section> : activeTab === "builder" ? <section className="builder-page">
      <div className="trials-heading"><span>AGENT WORKSHOP</span><h2>Build randomized strategy agents</h2><p>Each Agent creates a legal random betting plan using $5 increments. Save an Agent to make it available on the Table and in Trials.</p></div>
      <div className="agent-create"><input value={agentName} onChange={(e)=>setAgentName(e.target.value)} onKeyDown={(e)=>{if(e.key==="Enter")createAgent();}} placeholder="Give your Agent a name…"/><button onClick={createAgent} disabled={!agentName.trim()}>CREATE AGENT</button></div>
      {!agents.length?<div className="builder-empty"><strong>No Agents yet</strong><span>Name your first Agent to generate a random strategy.</span></div>:<div className="agent-grid">{agents.map((agent)=><article className="agent-card" key={agent.id}>
        <div className="agent-card-head"><div><span>AGENT</span><input value={agent.name} onChange={(e)=>updateAgent(agent.id,{name:e.target.value})}/></div><button onClick={()=>setAgents((items)=>items.filter((item)=>item.id!==agent.id))}><Trash2 size={15}/></button></div>
        <div className="agent-summary"><span><b>{Object.keys(agent.bets).length}</b> active bets</span><span><b>{money(Object.values(agent.bets).reduce((sum,amount)=>sum+amount,0))}</b> opening target</span><em>VALID STRATEGY</em></div>
        <div className="agent-bets">{Object.entries(agent.bets).map(([id,amount])=><div key={id}><span>{BETS[id].label}<small>{BETS[id].payout}</small></span><em>{canRebuyMidRound(id)?agent.rebuy?.[id]?"Always rebuy":"Next round only":"Next round only"}</em><b>{money(amount)}</b></div>)}</div>
        <div className="agent-actions"><button onClick={()=>updateAgent(agent.id,generateAgentStrategy())}>REGENERATE</button><button className="save-agent" onClick={()=>saveAgentStrategy(agent)}><Save size={14}/>{agent.savedStrategyId&&strategies.some((strategy)=>strategy.id===agent.savedStrategyId)?"UPDATE STRATEGY":"SAVE AS STRATEGY"}</button></div>
      </article>)}</div>}
    </section> : <section className="evolution-page">
      <div className="trials-heading"><span>EVOLUTION LAB</span><h2>Evolve betting strategies</h2><p>Generate a random population, evaluate every Agent, retain the fittest, and breed the next generation through crossover and mutation.</p></div>
      <div className="evolution-setup">
        <div className="card-heading"><span>EVOLUTION SETTINGS</span></div>
        <div className="evolution-fields">
          <label className="trial-field"><span>Generations</span><input type="number" min="1" max="50" value={evolutionGenerations} onChange={(e)=>setEvolutionGenerations(e.target.value)}/></label>
          <label className="trial-field"><span>Population per generation</span><input type="number" min="2" max="100" value={evolutionPopulation} onChange={(e)=>setEvolutionPopulation(e.target.value)}/></label>
          <label className="trial-field"><span>Trials per Agent</span><input type="number" min="1" max="500" value={evolutionTrials} onChange={(e)=>setEvolutionTrials(e.target.value)}/></label>
          <label className="trial-field"><span>Rolls per trial</span><input type="number" min="1" max="5000" value={evolutionRolls} onChange={(e)=>setEvolutionRolls(e.target.value)}/></label>
          <label className="trial-field"><span>Keep top population (%)</span><input type="number" min="10" max="90" step="5" value={evolutionThreshold} onChange={(e)=>setEvolutionThreshold(e.target.value)}/></label>
          <label className="trial-field"><span>Mutation chance (%)</span><input type="number" min="0" max="100" step="1" value={evolutionMutation} onChange={(e)=>setEvolutionMutation(e.target.value)}/></label>
        </div>
        <div className="evolution-note"><span>Mutation adds, removes, or changes one wager gene.</span><b>Estimated rolls: {(Math.max(0,Number(evolutionGenerations)||0)*Math.max(0,Number(evolutionPopulation)||0)*Math.max(0,Number(evolutionTrials)||0)*Math.max(0,Number(evolutionRolls)||0)).toLocaleString()}</b></div>
        {evolutionError&&<p className="evolution-error">{evolutionError}</p>}
        <button className="run-trials" onClick={runEvolution} disabled={evolutionRunning}>{evolutionRunning?`GENERATION ${evolutionProgress?.generation||1} OF ${evolutionProgress?.generations||evolutionGenerations} · AGENT ${evolutionProgress?.agent||0}/${evolutionProgress?.population||evolutionPopulation}`:"START EVOLUTION"}</button>
      </div>
      {evolutionResults&&<>
        <div className="generation-summary"><div className="analytics-title"><span>GENERATION PROGRESS</span><small>Best and mean fitness by generation</small></div><div className="generation-list">{evolutionResults.generationHistory.map((generation)=><div key={generation.generation}><span>GEN {generation.generation}</span><b>{generation.best.toFixed(2)}</b><small>mean {generation.mean.toFixed(2)}</small></div>)}</div></div>
        <div className="evolution-results"><div className="analytics-title"><span>FINAL GENERATION</span><small>Ranked by fitness score · {evolutionResults.agents.length} Agents</small></div><div className="evolution-agent-list">{evolutionResults.agents.map((agent,index)=><article className="evolution-agent" key={agent.id}>
          <div className="evolution-rank">#{index+1}</div><div className="evolution-identity"><strong>{agent.name}</strong><small>{Object.keys(agent.bets).length} bets{agent.parents?` · bred from ${agent.parents.join(" + ")}`:" · original population"}</small></div><div className="evolution-fitness"><span>FITNESS</span><b>{agent.analytics.fitness.toFixed(2)}</b></div><button className="save-evolution" onClick={()=>saveEvolutionAgent(agent)} disabled={Boolean(savedEvolutionAgents[agent.id])}><Save size={14}/>{savedEvolutionAgents[agent.id]?"SAVED":"ADD STRATEGY"}</button>
          <div className="evolution-metrics"><span><b>Max</b>{money(agent.analytics.max)}</span><span><b>Min</b>{money(agent.analytics.min)}</span><span><b>Mean</b>{money(agent.analytics.mean)}</span><span><b>Median</b>{money(agent.analytics.median)}</span><span><b>Std dev</b>{money(agent.analytics.stdDev)}</span><span><b>Profit</b>{agent.analytics.profits} / {evolutionResults.config.trials}</span><span><b>Loss</b>{agent.analytics.losses} / {evolutionResults.config.trials}</span><span><b>Bankrupt</b>{agent.analytics.bankruptcies} / {evolutionResults.config.trials}</span></div>
          <details className="evolution-bets"><summary>View strategy bets</summary><div>{Object.entries(agent.bets).map(([id,amount])=><span key={id}><b>{BETS[id].label}<small>{canRebuyMidRound(id)?agent.rebuy?.[id]?"Always rebuy":"Next round only":"Next round only"}</small></b>{money(amount)}</span>)}</div></details>
        </article>)}</div></div>
      </>}
    </section>}
  </main>;
}
