const jwt = require("jsonwebtoken");

const logsPath = Runtime.getAssets()['/logs.private.js'].path;
const { logFinalAction, logInitialAction, logInterimAction } = require(logsPath);

const createTokenPath = Runtime.getAssets()['/createToken.private.js'].path;
const { createToken } = require(createTokenPath);

const { API_SECRET } = process.env;

exports.handler = async (context, event, callback) => {
    logInitialAction("Refreshing token");
    let providedIdentity;

    const response = new Twilio.Response();
    response.appendHeader('Access-Control-Allow-Origin', '*');
    response.appendHeader('Access-Control-Allow-Methods', 'OPTIONS POST GET');
    response.appendHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.appendHeader('Content-Type', 'application/json');

    try {
        const validatedToken = await new Promise((res, rej) =>
            jwt.verify(event.token, API_SECRET, {}, (err, decoded) => {
                if (err) return rej(err);
                return res(decoded);
            })
        );
        providedIdentity = validatedToken?.grants?.identity;
    } catch (e) {
        logInterimAction("Invalid token provided:", e.message);
        response.setStatusCode(403);
        callback(response);
    }

    logInterimAction("Token is valid for", providedIdentity);

    const refreshedToken = createToken(providedIdentity);

    response.setBody({
        token: refreshedToken,
        expiration: Date.now() + TOKEN_TTL_IN_SECONDS * 1000
    });

    callback(null, response);


    logFinalAction("Token refreshed");

}