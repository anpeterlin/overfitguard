// GET /api/health — liveness probe.
export default function handler(req, res) {
  res.status(200).json({ ok: true, service: 'overfitguard-backend' });
}
