// supabase-client.js — single source of truth for the Supabase client.
// -----------------------------------------------------------------------------
// Every page that used to inline:
//   const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
// now just loads this file AFTER the @supabase/supabase-js CDN script.
//
// Exposes the client as `window.sb` (matching the variable name every page's
// inline code already uses — zero rewrites needed downstream). NOT exposed as
// `window.supabase` because the CDN uses that name for the LIBRARY itself
// (which is where `supabase.createClient` comes from); overwriting it would
// break any future page trying to construct another client.
// -----------------------------------------------------------------------------
(function () {
  var SUPABASE_URL  = 'https://lagjjcpclvzrjlrswojt.supabase.co';
  var SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhZ2pqY3BjbHZ6cmpscnN3b2p0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzODY1MDAsImV4cCI6MjEwMDk2MjUwMH0.sxOq3pWnK2k60rE-w6in2rcuWyQOT3ngrsAzY0VcVY4';

  if (!window.supabase || !window.supabase.createClient) {
    console.error('supabase-client.js: @supabase/supabase-js not loaded yet — include the CDN <script> BEFORE this file.');
    return;
  }
  window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
})();
