import { fetchUsers } from './api';
import { Header } from './components/Header';

class App {
    render() {
        const header = new Header();
        header.render();
        fetchUsers();
    }

    fetchData() {
        return fetchUsers();
    }
}

export { App };
