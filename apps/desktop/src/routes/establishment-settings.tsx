import { useEffect, useState } from "react";
import { useEstablishment, updateEstablishmentSettings } from "../lib/closing";

/**
 * Configurações gerais do estabelecimento (dono). Antes vivia dentro de
 * Cardápio, empurrando Categorias/Produtos pra baixo com uma seção inteira
 * de topo pra uma configuração raramente alterada — ganhou página própria
 * (achado em uso real, 2026-09-22).
 */
function EstablishmentSettings() {
  const { status, defaultServiceFeePercent, refresh } = useEstablishment();

  const [serviceFeePercent, setServiceFeePercent] = useState("10");
  const [serviceFeeError, setServiceFeeError] = useState<string | null>(null);
  const [serviceFeeSubmitting, setServiceFeeSubmitting] = useState(false);
  const [serviceFeeSaved, setServiceFeeSaved] = useState(false);

  useEffect(() => {
    if (status === "ready") setServiceFeePercent(String(defaultServiceFeePercent));
  }, [status, defaultServiceFeePercent]);

  async function handleSaveServiceFee(e: React.FormEvent) {
    e.preventDefault();
    const percent = Number(serviceFeePercent.replace(",", "."));
    if (!Number.isFinite(percent) || percent < 0 || serviceFeeSubmitting) return;
    setServiceFeeSubmitting(true);
    setServiceFeeError(null);
    setServiceFeeSaved(false);
    const result = await updateEstablishmentSettings(percent);
    setServiceFeeSubmitting(false);
    if (!result.ok) {
      setServiceFeeError(result.error);
      return;
    }
    setServiceFeeSaved(true);
    refresh();
  }

  if (status === "loading") {
    return (
      <section>
        <p>Carregando...</p>
      </section>
    );
  }

  return (
    <section>
      <h2>Configurações do estabelecimento</h2>
      <div className="table-map-section settings-section">
        <h3>Taxa de serviço padrão</h3>
        <form onSubmit={handleSaveServiceFee} className="inline-form">
          <label>
            Taxa de serviço padrão (%)
            <input
              value={serviceFeePercent}
              onChange={(e) => {
                setServiceFeePercent(e.target.value.replace(/[^0-9,.]/g, ""));
                setServiceFeeSaved(false);
              }}
              inputMode="decimal"
            />
          </label>
          <button type="submit" className="button-primary" disabled={serviceFeeSubmitting}>
            Salvar
          </button>
        </form>
        {serviceFeeError && <p className="form-error">{serviceFeeError}</p>}
        {serviceFeeSaved && <p>Taxa de serviço padrão atualizada.</p>}
      </div>
    </section>
  );
}

export default EstablishmentSettings;
