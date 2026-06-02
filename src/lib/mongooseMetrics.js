const MAX_LATENCY_SAMPLES = 1000;
const QUERY_OPERATIONS = [
  "countDocuments",
  "deleteMany",
  "deleteOne",
  "find",
  "findOne",
  "findOneAndDelete",
  "findOneAndUpdate",
  "updateMany",
  "updateOne"
];

function metricsStore() {
  if (!globalThis.__questRoomMongoMetrics) globalThis.__questRoomMongoMetrics = new Map();
  return globalThis.__questRoomMongoMetrics;
}

function recordQuery(query, error = null) {
  const startedAt = Number(query.__questRoomMetricsStartedAt);
  if (!startedAt) return;
  query.__questRoomMetricsStartedAt = 0;
  const key = `${query.model?.modelName || "Unknown"}.${query.op || "query"}`;
  const store = metricsStore();
  if (!store.has(key)) {
    store.set(key, { count: 0, errors: 0, bytes: 0, latencySamples: [] });
  }
  const stats = store.get(key);
  stats.count += 1;
  if (error) stats.errors += 1;
  stats.latencySamples.push(performance.now() - startedAt);
  if (stats.latencySamples.length > MAX_LATENCY_SAMPLES) stats.latencySamples.shift();
}

export function installMongooseMetrics(mongoose) {
  if (globalThis.__questRoomMongooseMetricsInstalled) return;
  globalThis.__questRoomMongooseMetricsInstalled = true;

  mongoose.plugin((schema) => {
    schema.pre(QUERY_OPERATIONS, function startQueryMetrics() {
      this.__questRoomMetricsStartedAt = performance.now();
    });
    schema.post(QUERY_OPERATIONS, function finishQueryMetrics() {
      recordQuery(this);
    });
    schema.post(QUERY_OPERATIONS, function finishFailedQueryMetrics(error, _result, next) {
      recordQuery(this, error);
      next(error);
    });
  });
}
