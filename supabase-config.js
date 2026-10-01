(function () {
  'use strict';

  // Cole aqui apenas a chave anon/public do Supabase. Nunca use service_role no navegador.
  window.SUPABASE_CONFIG = {
    url: 'https://vwlpoeyqifnjcjoaltgf.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ3bHBvZXlxaWZuamNqb2FsdGdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA3NzA2MDksImV4cCI6MjEwNjM0NjYwOX0._gNjA3E8pCj2KoCAHEAlh8dDLgQxsTgsJsUx35A7rCQ',
    authEmails: {
      MASTER: 'master@donorte.com.br',
      FINANCEIRO: 'financeiro@donorte.com.br',
      TRANSFERENCIA: 'transferencia@donorte.com.br',
      GERENTE: 'gerente@donorte.com.br',
      COMPRAS: 'compras@donorte.com.br'
    }
  };
})();
