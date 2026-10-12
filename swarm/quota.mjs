// Bounded local reservation ledger, NOT a Cloudflare/provider allowance API.
// Counters are deliberately conservative: uncertain calls still consume a reservation.
const ownerOK=x=>typeof x==='string'&&/^\d{15,22}$/.test(x);
export const MAX_DAILY_CAP=18;
export function utcDay(ms=Date.now()){
 if(!Number.isFinite(ms)||ms<0)throw TypeError('Invalid timestamp');
 return new Date(ms).toISOString().slice(0,10);
}
export function parseDailyCap(value){
 const cap=typeof value==='string'&&/^[1-9]\d*$/.test(value)?Number(value):value;
 if(!Number.isInteger(cap)||cap<1||cap>MAX_DAILY_CAP)
   throw RangeError('The owner must explicitly configure a daily cap of 1..18');
 return cap;
}
export async function reserveDailyFreeCall(db,{ownerId,cap,now=Date.now()}){
 if(!db?.prepare||!ownerOK(ownerId))throw TypeError('Invalid dedicated DB or owner');
 cap=parseDailyCap(cap);
 const day=utcDay(now);
 await db.prepare("INSERT INTO swarm_budget_days (owner_id,utc_day,cap,reserved,updated_at) VALUES (?,?,?,0,?) ON CONFLICT(owner_id,utc_day) DO NOTHING")
   .bind(ownerId,day,cap,now).run();
 // Atomic update, not SELECT followed by UPDATE: competing workers cannot overspend the local cap.
 // The cap may only be decreased by new configuration during this UTC day.
 const row=await db.prepare("UPDATE swarm_budget_days SET reserved=reserved+1,updated_at=? WHERE owner_id=? AND utc_day=? AND reserved<MIN(cap,?) RETURNING reserved")
   .bind(now,ownerId,day,cap).first();
 return row?'allowed':'quota_wait';
}
export async function ownerDailyUsage(db,{ownerId,now=Date.now()}){
 if(!db?.prepare||!ownerOK(ownerId))throw TypeError('Invalid dedicated DB or owner');
 const row=await db.prepare('SELECT cap,reserved FROM swarm_budget_days WHERE owner_id=? AND utc_day=?')
   .bind(ownerId,utcDay(now)).first();
 return {day:utcDay(now),cap:row?.cap??null,reserved:row?.reserved??0,
  note:'Only locally reserved calls; not the upstream provider allowance'};
}
