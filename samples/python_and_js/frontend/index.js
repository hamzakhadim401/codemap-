import { App } from './App';
import { setupApi } from './api';

function init() {
    setupApi();
    const app = new App();
    app.render();
}

init();
