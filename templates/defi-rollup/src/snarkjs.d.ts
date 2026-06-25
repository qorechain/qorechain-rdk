// Minimal ambient declaration for snarkjs (which ships without types). Only the
// surface used by the reference prover is declared.
declare module "snarkjs" {
  export const groth16: {
    fullProve(
      input: Record<string, unknown>,
      wasmPath: string,
      zkeyPath: string,
    ): Promise<{ proof: unknown; publicSignals: unknown }>;
    verify(vkey: unknown, publicSignals: unknown, proof: unknown): Promise<boolean>;
  };
}
