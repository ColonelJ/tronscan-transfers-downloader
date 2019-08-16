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

async function download_transfers(uri) {
    let transfers;
    let options;
    let reply;
    let total;
    while (true) {
        transfers = [];
        options = {
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
        reply = await rpn(options);
        total = reply.rangeTotal;
        while (true) {
            transfers.push(...reply.data);
            console.log('Downloaded ' + transfers.length + '/' + total);
            options.qs.start += options.qs.limit;
            if (reply.data.length < options.qs.limit) {
                break;
            }
            reply = await rpn(options);
            if (reply.rangeTotal != total) {
                break;
            }
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
        let record_sets = [];
        console.log('Downloading TRX/TRC10 transfers...');
        record_sets.push(await download_transfers('https://apilist.tronscan.org/api/transfer'));
        console.log('Downloading TRC20 transfers...');
        record_sets.push(await download_transfers('https://apilist.tronscan.org/api/contract/events'));
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
            await csvFile.write(stringify([[record.transactionHash, record.timestamp, record.block, record.transferFromAddress, record.transferToAddress, record.decimals || '', record.amount, record.tokenName]]));
        }
        console.log('Successfully written all records to ' + outputFile + '!');
    } finally {
        if (csvFile !== undefined) {
            await csvFile.close();
        }
    }
}

main()
