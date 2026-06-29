const BASE_URL = 'http://localhost:3000/api';

function setupApi() {
    console.log('API configured:', BASE_URL);
    return BASE_URL;
}

function fetchUsers() {
    return callApi('/users');
}

function callApi(endpoint) {
    return fetch(BASE_URL + endpoint);
}

export { setupApi, fetchUsers };
