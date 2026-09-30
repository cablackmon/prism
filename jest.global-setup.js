// Jest's test sandbox gets a copy of process.env, so a TZ assignment inside a test file never
// reaches the real process. Pin the board's zone (Central) here so every run, on any host, agrees.
module.exports = async () => {
  process.env.TZ = 'America/Chicago';
};
