/**
 * @NApiVersion 2.0
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
*/

define(['N/record', 'N/log', 'N/search', 'N/https', 'N/runtime'], function (record, log, search, https, runtime) {
    function beforeSubmit(context) {
        if (context.type == context.UserEventType.DELETE) {
            var objRecord = context.newRecord;
            var recordType = context.newRecord.type;
            if (recordType == 'invoice') {
                var invoiceId = context.newRecord.id;
                getCancelamento(invoiceId);
            }
        }
        return true;
    }

    function afterSubmit(context) {
        var objRecord = context.newRecord;
        var recordType = context.newRecord.type;
        if (context.type == context.UserEventType.CREATE) {
            if (recordType == 'invoice') {
                getInvoice(context);
            }
        }
        if (context.type == context.UserEventType.CREATE) {
            if (recordType == 'customtransaction_o2s_cancelamento') {
                var invoiceId = objRecord.getValue({ fieldId: 'custbody_o2s_transaction_l_origem' });
                if (invoiceId != '') {
                    getCancelamento(invoiceId);
                }
            }
        }

        return true;
    }

    function getCancelamento(invoiceId) {
        try {
            var lookupInvoice = search.lookupFields({
                type: 'invoice',
                id: invoiceId,
                columns: ['createdfrom']
            });
            if (lookupInvoice.createdfrom != '[]') {
                var salesorderId = lookupInvoice.createdfrom[0].value;
                updateSO(salesorderId, 'previousNumber');
            }
            return true;
        } catch (err) {
            log.error({ title: 'Error Function "getCancelamento"', detais: err });
            return false;
        }
    }

    function getInvoice(context) {
        try {
            // Get Current Record
            var objRecord = context.newRecord;
            var invoiceId = context.newRecord.id;
            var salesorderId = objRecord.getValue({ fieldId: 'createdfrom' });
            if (salesorderId == '') { return true; }

            // Load Sales Order
            var lookupSalesOrder = search.lookupFields({
                type: 'salesorder',
                id: salesorderId,
                columns: [
                    'custbody_rsm_descricao_item_so',
                    'custbody_rsm_proxima_parcela_so',
                    'custbody_rsm_total_parcelas_so',
                    'custbody_rsm_parcelas_restantes_so',
                    'otherrefnum'
                ]
            });

            // Get Field Value
            // var descitem = lookupSalesOrder.custbody_rsm_descricao_item_so;
            var parcAtual = lookupSalesOrder.custbody_rsm_proxima_parcela_so;
            var parcTotal = lookupSalesOrder.custbody_rsm_total_parcelas_so;
            var parcResta = lookupSalesOrder.custbody_rsm_parcelas_restantes_so;
            var poid = lookupSalesOrder.otherrefnum;

            // If All Parcela is issued, not execute
            if (parcTotal == '') { return true; }

            // Update Item Description and Parcela Counter
            var invoiceId = updateInvoice(invoiceId, /*descitem,*/ poid, parcAtual, parcTotal);
            if (invoiceId != '') {
                updateSO(salesorderId, 'nextNumber');
            }

            // Exit Function
            return true;
        } catch (err) {
            log.error({ title: 'Error Function "getInvoice"', detais: err });
            return false;
        }
    }

    function updateInvoice(invoiceId, /*descitem,*/ poid, parcAtual, parcTotal) {
        try {
            // Parcela a Imprimir
            var parcUtil = Number(parcAtual) + 1;

            // Load Invoice
            var objInvoice = record.load({ type: 'invoice', id: invoiceId, isDynamic: false });

            // Get Field Value
            //Chamado 6731
            var tranData = [];
            var transactionSearchObj = search.create({
                type: "transaction",
                filters:
                    [
                        ["internalid", "anyof", invoiceId],
                        "AND",
                        ["mainline", "is", "T"]
                    ],
                columns:
                    [
                        search.createColumn({
                            name: "custrecord_sit_parcela_l_transacao",
                            join: "CUSTRECORD_SIT_PARCELA_L_TRANSACAO",
                            label: "Transação"
                        }),
                        search.createColumn({
                            name: "custrecord_sit_parcela_n_valor",
                            join: "CUSTRECORD_SIT_PARCELA_L_TRANSACAO",
                            label: "Valor Parcela"
                        }),
                        search.createColumn({
                            name: "internalid",
                            join: "CUSTRECORD_SIT_PARCELA_L_TRANSACAO",
                            label: "ID interno"
                        })
                    ]
            });
            var searchResultCount = transactionSearchObj.runPaged().count;
            log.debug("transactionSearchObj result count", searchResultCount);
            transactionSearchObj.run().each(function (result) {
                // .run().each has a limit of 4,000 results
                const columns = result.columns;
                const tran = parseFloat(result.getValue(columns[1]));
                tranData.push(tran);
                return true;
            });

            log.debug({ title: "tranData", details: tranData });
            var soma = 0;
            for (var i = 0; i < tranData.length; i++) {
                soma += tranData[i];
            }
            soma = (soma * 100) / 100;
            soma = soma.toString().replace('.', ',');
            log.debug({ title: "soma", details: soma });

            /**var valorliquido = objInvoice.getValue({ fieldId: 'total' });

            var pis = objInvoice.getValue({fieldId:'custbody_sit_invoice_pis'});
            var cofins = objInvoice.getValue({ fieldId: 'custbody_sit_invoice_cofins'});
            var csll = objInvoice.getValue({ fieldId: 'custbody_sit_invoice_csll'});
            var total = valorliquido - pis - cofins - csll;
            //valorliquido = valorliquido.toString().replace('.', ',');
            total = total.toString().replace('.', ',');
            */
            //Chamado 6731 End
            var subs = objInvoice.getValue({ fieldId: 'subsidiary' });
            var bancoSP = 'Banco Itau ag 0393 c/c 61.550-5';//subsidiary = 3
            var bancoDF = 'Banco Itau ag 0393 c/c 04.872-3';//subsidiary = 12
            var descitem = objInvoice.getSublistValue({ sublistId: 'item', fieldId: 'description', line: 0 });

            // Set Item Description
            if (descitem != '') { descitem += '\n'; }
            if (poid != '') { descitem += 'PO: ' + poid + '\n'; }
            if (subs == 3) {
                //descitem += 'Parcela: ' + parcUtil + '/' + parcTotal + '\n' + 'Valor Líquido: R$ ' + valorliquido  + "\n" + bancoSP;
                descitem += 'Parcela: ' + parcUtil + '/' + parcTotal + '\n' + 'Valor Líquido: R$ ' + soma + "\n" + bancoSP;
            } else if (subs == 12) {
                //descitem += 'Parcela: ' + parcUtil + '/' + parcTotal + '\n' + 'Valor Líquido: R$ ' + valorliquido  + "\n" + bancoDF;
                descitem += 'Parcela: ' + parcUtil + '/' + parcTotal + '\n' + 'Valor Líquido: R$ ' + soma + "\n" + bancoDF;
            } else {
                descitem += 'Installment : ' + parcUtil + '/' + parcTotal;
            }
            objInvoice.setSublistValue({ sublistId: 'item', fieldId: 'description', line: 0, value: descitem });
            var invoiceId = objInvoice.save({ enableSourcing: false, ignoreMandatoryFields: true });

            forceInvoiceUpdate(objInvoice);

            return invoiceId;
        } catch (err) {
            log.debug({ title: 'Error Function "updateInvoice"', details: err });
            return '';
        }
    }

    function updateSO(salesorderId, action) {
        try {
            // Get Sales Order Counter
            var lookupSalesOrder = search.lookupFields({
                type: 'salesorder',
                id: salesorderId,
                columns: [
                    'custbody_rsm_proxima_parcela_so',
                    'custbody_rsm_parcelas_restantes_so'
                ]
            });
            var parcAtual = lookupSalesOrder.custbody_rsm_proxima_parcela_so;
            var parcResta = lookupSalesOrder.custbody_rsm_parcelas_restantes_so;

            // Set Parameters
            switch (action) {
                case 'nextNumber':
                    parcAtual++;
                    parcResta--;
                    break;
                case 'previousNumber':
                    parcAtual--;
                    parcResta++;
                    break;
            }

            // Update Sales Order Parcela
            record.submitFields({
                type: 'salesorder',
                id: salesorderId,
                values: {
                    custbody_rsm_proxima_parcela_so: parcAtual,
                    custbody_rsm_parcelas_restantes_so: parcResta
                },
                options: { enableSourcing: false, ignoreMandatoryFields: true }
            });
            return true;
        } catch (err) {
            log.error({ title: 'Error Function "updateSO"', detais: err });
        }
    }

    function forceInvoiceUpdate(invoiceRecord) {
        if(runtime.executionContext == runtime.ContextType.RESTLET) {
            return;
        }

        const _response = https.requestRestlet({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            scriptId: 'customscript_rsmbr_tra_transact_updat_rt',
            deploymentId: 'customdeploy_rsmbr_tra_transact_updat_rt',
            body: JSON.stringify(
                {
                    type: invoiceRecord.type,
                    id: invoiceRecord.id
                }
            )
        });

        if(_response.status != 200) {
            log.error({
                title: 'Transaction Update Error #' + invoiceRecord.id,
                details: _response.body
            });
        }
    }

    return {
        beforeSubmit: beforeSubmit,
        afterSubmit: afterSubmit
    }
});
