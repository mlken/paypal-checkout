/* @flow */

import * as $logger from 'beaver-logger/client';
import { bridge } from 'post-robot/src';

import { config, FPTI } from './config';
import { initLogger, checkForCommonErrors, setLogLevel, stringifyError, stringifyErrorMessage, getResourceLoadTime } from './lib';
import { createPptmScript } from './lib/pptm';
import { isPayPalDomain, isEligible, getDomainSetting, once } from './lib';

import { ZalgoPromise } from 'zalgo-promise/src';

function domainToEnv(domain : string) : ?string {
    for (let env of Object.keys(config.paypalUrls)) {
        if (config.paypalUrls[env] === domain) {
            return env;
        }
    }
}

function setDomainEnv(domain : string) {
    let currentDomainEnv = domainToEnv(domain);

    if (currentDomainEnv && currentDomainEnv !== 'test') {
        config.env = currentDomainEnv;
    }
}

setDomainEnv(`${window.location.protocol}//${window.location.host}`);

ZalgoPromise.onPossiblyUnhandledException(err => {

    $logger.error('unhandled_error', {
        stack: stringifyError(err),
        errtype: ({}).toString.call(err)
    });

    $logger.track({
        [ FPTI.KEY.ERROR_CODE ]: 'checkoutjs_error',
        [ FPTI.KEY.ERROR_DESC ]: stringifyErrorMessage(err)
    });

    $logger.flush().catch(err2 => {
        if (window.console) {
            try {
                if (window.console.error) {
                    window.console.error('Error flushing:', err2.stack || err2.toString());
                } else if (window.console.log) {
                    window.console.log('Error flushing:', err2.stack || err2.toString());
                }
            } catch (err3) {
                setTimeout(() => {
                    throw err3;
                }, 1);
            }
        }
    });
});


function getCurrentScript() : ? HTMLScriptElement {

    let scripts = Array.prototype.slice.call(document.getElementsByTagName('script'));

    for (let script of scripts) {
        if (script.src && script.src.replace(/^https?:/, '').split('?')[0] === config.scriptUrl || script.hasAttribute('data-paypal-checkout')) {
            return script;
        }

        if (script.src && script.src.indexOf('paypal.checkout.v4.js') !== -1) {
            return script;
        }
    }

    if (document.currentScript) {
        $logger.debug(`current_script_not_recognized`, { src: document.currentScript.src });
    }
}

let currentScript = getCurrentScript();
let currentProtocol = window.location.protocol.split(':')[0];


type ConfigOptions = {
    env? : ?string,
    stage? : ?string,
    apiStage? : ?string,
    state? : ?string,
    ppobjects? : ?boolean,
    logLevel? : ?string
};

function configure({ env, stage, apiStage, paypalUrl, state, ppobjects, logLevel } : ConfigOptions = {}) {

    if (env) {
        if (!config.paypalUrls[env]) {
            throw new Error(`Invalid env: ${env}`);
        }

        delete config.env;
        config.env = env;
    }

    if (stage) {
        delete config.stage;
        config.stage = stage;
    }

    if (apiStage) {
        delete config.apiStage;
        config.apiStage = apiStage;
    }

    if (state) {
        delete config.state;
        config.state = state;
    }

    if (ppobjects) {
        config.ppobjects = true;
    }

    if (logLevel) {
        setLogLevel(logLevel);
    } else {
        setLogLevel(config.logLevel);
    }
}

export let init = once(() => {

    if (!isEligible()) {
        $logger.warn('ineligible');
    }

    checkForCommonErrors();

    if (!isPayPalDomain()) {
        createPptmScript();
    }

    initLogger();

    if (getDomainSetting('force_bridge') && bridge && !isPayPalDomain()) {
        bridge.openBridge(config.postBridgeUrls[config.env], config.paypalDomains[config.env]);
    }

    $logger.info(`setup_${config.env}`);

    $logger.debug(`current_protocol_${currentProtocol}`);
});

export function setup(options : ConfigOptions = {}) {
    configure(options);
    init();
}

if (currentScript) {

    setup({
        env:        currentScript.getAttribute('data-env'),
        stage:      currentScript.getAttribute('data-stage'),
        apiStage:   currentScript.getAttribute('data-api-stage'),
        state:      currentScript.getAttribute('data-state'),
        logLevel:   currentScript.getAttribute('data-log-level'),
        ppobjects:  true
    });

    let scriptProtocol = currentScript.src.split(':')[0];

    let loadTime = getResourceLoadTime(currentScript.src);

    $logger.debug(`current_script_protocol_${scriptProtocol}`);
    $logger.debug(`current_script_protocol_${ currentProtocol === scriptProtocol ? 'match' : 'mismatch' }`);
    $logger.debug(`current_script_version_${ config.version.replace(/[^0-9a-zA-Z]+/g, '_') }`);

    if (loadTime && !isPayPalDomain()) {
        $logger.debug(`current_script_time`, { loadTime });
        $logger.debug(`current_script_time_${ Math.floor(loadTime / 1000) }`);
    }

    $logger.track({
        [ FPTI.KEY.STATE ]: FPTI.STATE.LOAD,
        [ FPTI.KEY.TRANSITION ]: FPTI.TRANSITION.SCRIPT_LOAD,
        [ FPTI.KEY.TRANSITION_TIME ]: loadTime
    });

} else {
    $logger.track({
        [ FPTI.KEY.STATE ]: FPTI.STATE.LOAD,
        [ FPTI.KEY.TRANSITION ]: FPTI.TRANSITION.SCRIPT_LOAD
    });

    $logger.debug(`no_current_script`);
    $logger.debug(`no_current_script_version_${ config.version.replace(/[^0-9a-zA-Z]+/g, '_') }`);

    if (document.currentScript) {
        $logger.debug(`current_script_not_recognized`, { src: document.currentScript.src });
    }

    setup();
}
