const crypto = require('crypto');
const db = require('./db');

const PLANS = Object.freeze({
  free: { monthlyLimit: 500, maxTokens: 1 },
  pro: { monthlyLimit: 10000, maxTokens: 5 },
  business: { monthlyLimit: 100000, maxTokens: 20 }
});

function getPlan(userId) {
  const user = db.prepare('SELECT subscription_plan FROM users WHERE id=?').get(userId);
  const plan = user?.subscription_plan && PLANS[user.subscription_plan] ? user.subscription_plan : 'free';
  return { name: plan, ...PLANS[plan] };
}

function currentPeriodStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function createToken(userId, name = 'API Token') {
  const plan = getPlan(userId);
  const activeCount = db.prepare('SELECT COUNT(*) count FROM api_tokens WHERE user_id=? AND revoked_at IS NULL').get(userId).count;
  if (activeCount >= plan.maxTokens) {
    const error = new Error(plan.name === 'free'
      ? 'Le plan gratuit inclut 1 token API. Un abonnement est nécessaire pour créer des tokens supplémentaires.'
      : `Limite de ${plan.maxTokens} tokens atteinte pour le plan ${plan.name}.`);
    error.code = 'TOKEN_LIMIT_REACHED';
    error.status = 402;
    throw error;
  }

  const raw = `qm_tok_${crypto.randomBytes(32).toString('hex')}`;
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const prefix = raw.slice(0, 20);
  const periodStart = currentPeriodStart();
  const result = db.prepare(`
    INSERT INTO api_tokens(user_id,name,token_hash,token_prefix,plan,monthly_limit,request_count,period_start)
    VALUES(?,?,?,?,?,?,0,?)
  `).run(userId, String(name || 'API Token').trim().slice(0, 80) || 'API Token', hash, prefix, plan.name, plan.monthlyLimit, periodStart);

  return {
    id: Number(result.lastInsertRowid),
    name: String(name || 'API Token').trim().slice(0, 80) || 'API Token',
    token: raw,
    token_prefix: prefix,
    plan: plan.name,
    monthly_limit: plan.monthlyLimit,
    warning: 'Ce token ne sera plus affiché. Copiez-le maintenant.'
  };
}

function authenticateToken(raw) {
  if (!raw || !raw.startsWith('qm_tok_')) return null;
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return db.prepare('SELECT * FROM api_tokens WHERE token_hash=? AND revoked_at IS NULL').get(hash) || null;
}

function consumeQuota(token) {
  const periodStart = currentPeriodStart();
  let current = db.prepare('SELECT * FROM api_tokens WHERE id=? AND revoked_at IS NULL').get(token.id);
  if (!current) return { ok: false, reason: 'invalid' };

  if (current.period_start !== periodStart) {
    db.prepare('UPDATE api_tokens SET period_start=?,request_count=0 WHERE id=? AND revoked_at IS NULL').run(periodStart, current.id);
    current = db.prepare('SELECT * FROM api_tokens WHERE id=?').get(current.id);
  }

  const updated = db.prepare(`
    UPDATE api_tokens
    SET request_count=request_count+1,last_used_at=CURRENT_TIMESTAMP
    WHERE id=? AND revoked_at IS NULL AND request_count < monthly_limit
  `).run(current.id);

  if (updated.changes !== 1) {
    return {
      ok: false,
      reason: 'quota',
      used: current.request_count,
      limit: current.monthly_limit,
      reset: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1)).toISOString()
    };
  }

  const after = db.prepare('SELECT request_count,monthly_limit FROM api_tokens WHERE id=?').get(current.id);
  return {
    ok: true,
    used: after.request_count,
    limit: after.monthly_limit,
    remaining: Math.max(0, after.monthly_limit - after.request_count),
    reset: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1)).toISOString()
  };
}

function usage(userId) {
  const plan = getPlan(userId);
  const periodStart = currentPeriodStart();
  const tokens = db.prepare(`
    SELECT id,name,token_prefix,plan,monthly_limit,request_count,last_used_at,created_at,revoked_at
    FROM api_tokens WHERE user_id=? ORDER BY id DESC
  `).all(userId);
  return {
    plan: plan.name,
    monthly_limit_per_token: plan.monthlyLimit,
    max_tokens: plan.maxTokens,
    period_start: periodStart,
    reset_at: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1)).toISOString(),
    tokens
  };
}

module.exports = { PLANS, getPlan, createToken, authenticateToken, consumeQuota, usage, currentPeriodStart };
