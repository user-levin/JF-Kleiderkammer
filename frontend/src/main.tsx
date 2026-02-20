import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './styles/global.css';

const client = new QueryClient();

createRoot(document.getElementById('root') as HTMLElement).render(
  <QueryClientProvider client={client}>
    {/* Run under /ui on the server */}
    <BrowserRouter basename="/ui">
      <App />
    </BrowserRouter>
  </QueryClientProvider>
);