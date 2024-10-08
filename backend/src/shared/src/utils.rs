use ic_e8s::c::E8s;

pub fn f64_to_e8s(n: f64) -> E8s {
    if n < 0.0 {
        panic!("Only positive numbers allowed");
    }

    let n_u128 = (n * 1_0000_0000.0) as u128;

    E8s::from(n_u128 / 1_0000_0000)
}
