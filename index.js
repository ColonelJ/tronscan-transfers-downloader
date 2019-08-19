const rpn = require('request-promise-native');
const stringify = require('csv-stringify/lib/sync');
const fsPromises = require('fs').promises;

if (process.argv.length < 3) {
    console.error('Usage: node index.js TRON-ADDRESS [output.csv]');
    return;
}
const address = process.argv[2];
let outputFile = 'output.csv';
if (process.argv.length >= 4) {
    outputFile = process.argv[3];
}

function insert_decimal_point(amount, decimals) {
    amount = amount.toString();
    if (!decimals) {
        return amount;
    }
    if (amount.length <= decimals) {
        return '0.' + '0'.repeat(decimals - amount.length) + amount;
    }
    return amount.slice(0, amount.length - decimals) + '.' + amount.slice(amount.length - decimals);
}

let trc10_cache = {};

async function get_trc10_details(id) {
    if (trc10_cache[id]) {
        return trc10_cache[id];
    }
    let options = {
        uri: 'https://apilist.tronscan.org/api/token',
        qs: {
            id,
            showAll: 1
        },
        headers: {
            'User-Agent': 'Request-Promise-Native'
        },
        json: true
    };
    let reply = await rpn(options);
    if (!reply.data.length) {
        throw new Error("Couldn't retrieve information for TRC10 ID " + id);
    }
    trc10_cache[id] = reply.data[0];
    return trc10_cache[id];
}

let trc20_details;

async function download_trc20_details() {
    while (true) {
        trc20_details = {};
        let downloaded = 0;
        let options = {
            uri: 'https://apilist.tronscan.org/api/token_trc20',
            qs: {
                limit: 20,
                start: 0
            },
            headers: {
                'User-Agent': 'Request-Promise-Native'
            },
            json: true
        };
        let reply = await rpn(options);
        let total = reply.rangeTotal;
        while (true) {
            while (reply.total != total && reply.rangeTotal == total) {
                console.log('Error in query total (got ' + reply.total + ', expected ' + total + '), trying again...');
                reply = await rpn(options);
            }
            if (reply.rangeTotal != total) {
                break;
            }
            for (let i = 0; i < reply.trc20_tokens.length; ++i) {
                trc20_details[reply.trc20_tokens[i].name] = reply.trc20_tokens[i];
            }
            downloaded += reply.trc20_tokens.length;
            console.log('Downloaded ' + downloaded + '/' + total);
            options.qs.start += options.qs.limit;
            if (reply.trc20_tokens.length < options.qs.limit) {
                break;
            }
            reply = await rpn(options);
        }
        if (reply.rangeTotal != total) {
            console.log('Total number of TRC20s has changed, starting again');
        } else if (downloaded != total) {
            console.log("Total number of TRC20s downloaded doesn't match total, starting again");
        } else {
            break;
        }
    }
}

async function download_transfers(uri, transfer_processor) {
    let transfers;
    while (true) {
        transfers = [];
        let options = {
            uri,
            qs: {
                address,
                limit: 20,
                start: 0
            },
            headers: {
                'User-Agent': 'Request-Promise-Native'
            },
            json: true
        };
        let reply = await rpn(options);
        let total = reply.rangeTotal;
        while (true) {
            while (reply.total != total && reply.rangeTotal == total) {
                console.log('Error in query total (got ' + reply.total + ', expected ' + total + '), trying again...');
                reply = await rpn(options);
            }
            if (reply.rangeTotal != total) {
                break;
            }
            for (let i = 0; i < reply.data.length; ++i) {
                transfers.push(await transfer_processor(reply.data[i]));
            }
            console.log('Downloaded ' + transfers.length + '/' + total);
            options.qs.start += options.qs.limit;
            if (reply.data.length < options.qs.limit) {
                break;
            }
            reply = await rpn(options);
        }
        if (reply.rangeTotal != total) {
            console.log('Total number of transfers has changed, starting again');
        } else if (transfers.length != total) {
            console.log("Total number of transfers downloaded doesn't match total, starting again");
        } else {
            break;
        }
    }
    return transfers;
}

async function main() {
    console.log('Writing to file ' + outputFile + '...');
    let csvFile;
    try {
        csvFile = await fsPromises.open(outputFile, 'w');

        console.log('Downloading details of TRC20 tokens...');
        await download_trc20_details();

        let record_sets = [];
        console.log('Downloading TRX/TRC10 transfers...');
        record_sets.push(await download_transfers('https://apilist.tronscan.org/api/transfer', async function(transfer) {
            if (transfer.tokenName == '_') {
                transfer.decimals = 6;
                transfer.tokenAbbr = 'TRX';
                transfer.tokenFullName = 'Tronix';
            } else {
                let token_details = await get_trc10_details(transfer.tokenName);
                transfer.decimals = token_details.precision;
                transfer.tokenAbbr = token_details.abbr;
                transfer.tokenFullName = token_details.name;
            }
            return transfer;
        }));

        console.log('Downloading TRC20 transfers...');
        record_sets.push(await download_transfers('https://apilist.tronscan.org/api/contract/events', async function(transfer) {
            transfer.tokenAbbr = trc20_details[transfer.tokenName] ? trc20_details[transfer.tokenName].symbol : '';
            transfer.tokenFullName = transfer.tokenName;
            return transfer;
        }));

        while (record_sets.length) {
            let max_timestamp = 0;
            let max_timestamp_index;
            for (let i = 0; i < record_sets.length; ++i) {
                if (record_sets[i][0].timestamp > max_timestamp) {
                    max_timestamp = record_sets[i][0].timestamp;
                    max_timestamp_index = i;
                }
            }
            let record = record_sets[max_timestamp_index].shift();
            if (!record_sets[max_timestamp_index].length) {
                record_sets.splice(max_timestamp_index, 1);
            }
            await csvFile.write(stringify([[record.transactionHash, record.timestamp, record.block, record.transferFromAddress, record.transferToAddress, insert_decimal_point(record.amount, record.decimals), record.tokenName, record.tokenAbbr, record.tokenFullName]]));
        }
        console.log('Successfully written all records to ' + outputFile + '!');
    } finally {
        if (csvFile !== undefined) {
            await csvFile.close();
        }
    }
}

main()
