const Twilio = require("twilio");

const logsPath = Runtime.getAssets()['/logs.js'].path;
const { logFinalAction, logInitialAction, logInterimAction } = require(logsPath);

const { CONVERSATIONS_SERVICE_SID, ACCOUNT_SID, API_KEY, API_SECRET, TOKEN_TTL_IN_SECONDS } = process.env;

const createToken = (identity) => {
    logInterimAction("Creating new token");
    const { AccessToken } = Twilio.jwt;
    const { ChatGrant } = AccessToken;

    const chatGrant = new ChatGrant({
        serviceSid: CONVERSATIONS_SERVICE_SID
    });

    const token = new AccessToken(ACCOUNT_SID, API_KEY, API_SECRET, {
        identity,
        ttl: TOKEN_TTL_IN_SECONDS
    });
    token.addGrant(chatGrant);
    const jwt = token.toJwt();
    logInterimAction("New token created");
    return jwt;
};

module.exports = { createToken };
