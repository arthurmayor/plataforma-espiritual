require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const phones = [
  { label: 'T1 Sandra (Solidão)', phone: '+5511900000701' },
  { label: 'T2 Julia (Decepção com igreja)', phone: '+5511900000702' },
  { label: 'T3 José (Financeiro)', phone: '+5511900000703' },
  { label: 'T4 Maria (Relacionamento)', phone: '+5511900000704' },
  { label: 'T5 Roberto (Oração / filho internado)', phone: '+5511900000705' },
];

async function run() {
  for (const { label, phone } of phones) {
    const { data: profile } = await sb.from('profiles').select('id').eq('phone_e164', phone).maybeSingle();
    if (!profile) {
      console.log('\n--- ' + label + ' --- PERFIL NÃO ENCONTRADO');
      continue;
    }

    const { data: msgs } = await sb
      .from('messages')
      .select('direction, text_body, created_at')
      .eq('profile_id', profile.id)
      .order('created_at', { ascending: true });

    console.log('\n' + '='.repeat(60));
    console.log('=== ' + label + ' ===');
    console.log('='.repeat(60));
    for (const m of msgs || []) {
      const tag = m.direction === 'inbound' ? '[IN ]' : '[OUT]';
      console.log(tag + ' ' + m.text_body);
    }
  }
}

run().catch(console.error);
