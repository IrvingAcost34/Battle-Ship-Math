// =========================================================
// CONFIGURACIÓN DE SUPABASE
// Reemplaza estos dos valores con los de tu proyecto:
// Supabase Dashboard > Project Settings > API
// =========================================================
const SUPABASE_URL = 'https://mjgrkkluweqsitpdvafx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qZ3Jra2x1d2Vxc2l0cGR2YWZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4OTc4NzMsImV4cCI6MjA5OTQ3Mzg3M30.41-MJTb-6fl-lJTJE3jYPpNrINXZ2r8bihdo793Hk7E';

// El cliente se expone como `window.supabaseClient` para que
// lo usen game.js y organizer.js sin duplicar la inicialización.
window.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
