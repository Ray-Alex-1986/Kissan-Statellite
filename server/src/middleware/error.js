export function notFound(req, res) {
  res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
}

export function errorHandler(err, req, res, _next) {
  const status = err.status || 500;
  console.error(`[error] ${req.method} ${req.path}:`, err.message);
  res.status(status).json({ error: err.message || 'Internal server error' });
}

export function asyncWrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
