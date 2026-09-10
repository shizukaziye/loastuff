const fs=require('fs');
eval(fs.readFileSync('data.js','utf8').replace('const REWARDS','global.REWARDS'));
const M=require('../model.js');
const U={red:5,blue:0.5,shards:0,fusions:170,leap:10,juice:1100,gold:1,taps:250,brace:300,karma:100,astroU:0,astroR:500,astroE:10000,elysian:1500,kits:800,books:0,cards:0,gems:200000};
const key=REWARDS.keys.hell1750;
for (const [label,mech] of [['default',M.MECH_DEFAULTS],['no altars',Object.assign({},M.MECH_DEFAULTS,{altarW:{desc:0,chest:0,wealth:0,rocket:0}})],['no altars, no middle',Object.assign({},M.MECH_DEFAULTS,{altarW:{desc:0,chest:0,wealth:0,rocket:0},midUp:0})]]) {
  const dp=M.runDP(key,M.bandValues(key,U,mech),U,mech,'hell'); const fw=M.forward(dp,5);
  const pc=fw.term.reduce((a,b)=>a+b[1][0]+b[1][1],0), pw=fw.term.reduce((a,b)=>a+b[0][1]+b[1][1],0);
  console.log(label.padEnd(22),'rare EV',Math.round(dp.start(5)),'P(chest+1)',pc.toFixed(3),'P(wealth)',pw.toFixed(3),'bands',fw.term.map(b=>((b[0][0]+b[0][1]+b[1][0]+b[1][1])*100).toFixed(1)).join(' '));
}
