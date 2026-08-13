import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { getInvoiceDraft } from '../lib/api';

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function InvoiceView() {
  const { id } = useParams();
  const nav = useNavigate();
  const { profile } = useSession();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const isOffice = profile?.role === 'office' || profile?.role === 'admin';

  useEffect(() => {
    if (!isOffice) { setLoading(false); return; }
    getInvoiceDraft(id!).then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [id, isOffice]);

  async function approve() {
    if (!data?.draft?.id) return;
    const { error } = await supabase.from('invoice_drafts')
      .update({ status: 'approved', approved_by: profile?.id, approved_at: new Date().toISOString() })
      .eq('id', data.draft.id);
    setMsg(error ? error.message : 'Approved. Ready to send to the customer.');
  }

  if (!isOffice) return <div className="content"><div className="card">Prices are back-office only.</div></div>;
  if (loading) return <div className="spinner">Loading invoice…</div>;

  return (
    <div className="app">
      <div className="topbar">
        <button className="back" onClick={() => nav(`/jobs/${id}`)}>‹ Job</button>
        <div className="spacer" /><div className="sub">Draft invoice</div>
      </div>
      <div className="content">
        {!data ? (
          <div className="card muted">No draft yet — mark the job complete to generate one.</div>
        ) : (
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="pill">{data.draft.billing_mode}</span>
              <span className="pill">{data.draft.status}</span>
            </div>
            <table style={{ marginTop: 10 }}>
              <thead><tr><th>Unit</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Ext</th></tr></thead>
              <tbody>
                {data.lines.map((l: any, i: number) => (
                  <tr key={i}>
                    <td>{l.description}<div className="muted" style={{ fontSize: 11 }}>{l.source}</div></td>
                    <td className="num">{l.quantity}</td>
                    <td className="num">{money(Number(l.rate))}</td>
                    <td className="num">{money(Number(l.extended))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={3} className="num total">Total</td><td className="num total">{money(Number(data.draft.total))}</td></tr>
              </tfoot>
            </table>
            {msg && <div className="small" style={{ marginTop: 10, color: 'var(--ok)' }}>{msg}</div>}
            {data.draft.status === 'draft' && (
              <><div style={{ height: 12 }} /><button className="btn ok" onClick={approve}>Approve invoice</button></>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
