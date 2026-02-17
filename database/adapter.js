const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data.json');

const defaultData = { 
    users: [], 
    tasks: [], 
    groups: [] 
};

const initDB = () => {
    if (!fs.existsSync(DB_PATH)) {
        fs.writeFileSync(DB_PATH, JSON.stringify(defaultData, null, 2));
    }
};

const readDB = () => {
    initDB();
    try {
        const fileContent = fs.readFileSync(DB_PATH, 'utf-8');
        const data = JSON.parse(fileContent);
        if (!data.users) data.users = [];
        if (!data.tasks) data.tasks = [];
        if (!data.groups) data.groups = [];
        return data;
    } catch (e) {
        return defaultData;
    }
};

const writeDB = (data) => {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
};

module.exports = { readDB, writeDB };