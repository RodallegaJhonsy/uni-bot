const chrono = require('chrono-node');

const parseDate = (text) => {
    const results = chrono.es.parse(text);
    if (results.length > 0) {
        return results[0].start.date();
    }
    return null;
};

module.exports = { parseDate };