pragma circom 2.0.0;

// Reference circuit: proves knowledge of two factors `a` and `b` whose product
// is the public output `c`. This is intentionally tiny — replace it with the
// circuit that proves your rollup's state transition.
template Multiplier() {
    signal input a;
    signal input b;
    signal output c;
    c <== a * b;
}

component main = Multiplier();
