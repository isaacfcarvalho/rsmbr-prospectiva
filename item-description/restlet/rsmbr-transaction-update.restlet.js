/**
 * @NApiVersion 2.x
 * @NScriptType Restlet
 */
define(
    [
        'N/log',
        'N/record'
    ],
    function(log, record) {
        function post(data) {
            log.audit({ title: 'Posted Data', details: data });

            record
                .load({ type: data.type, id: data.id, isDynamic: true })
                .save({ ignoreMandatoryFields: true });
        }

        return {
            post: post
        }
    }
)