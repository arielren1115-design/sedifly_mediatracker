// All logging goes through here. Run Log tab writing arrives with M1.

/** @param {string} message @param {object} [detail] */
export function log(message, detail) {
  const line = detail === undefined ? message : `${message} ${JSON.stringify(detail)}`;
  console.log(`${new Date().toISOString()} ${line}`);
}
