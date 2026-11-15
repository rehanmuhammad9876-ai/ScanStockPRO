import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);
export default async function handler(req, res){
  if(req.method!=='POST') return res.status(405).json({error:'POST only'});
  try{
    const { image, sku } = req.body;
    const base64 = image.split(',')[1]; const buf = Buffer.from(base64,'base64');
    const ext = image.includes('png') ? 'png' : 'jpg';
    const name = `${sku}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('product-photos').upload(name, buf, {contentType:'image/'+ext, upsert:true});
    if(error) throw error;
    const { data } = supabase.storage.from('product-photos').getPublicUrl(name);
    return res.json({url: data.publicUrl});
  }catch(e){ return res.status(500).json({error:e.message}); }
}
