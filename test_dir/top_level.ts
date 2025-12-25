function topLevelFunction() {
    let x = 1;
    const foo = () => {
        return x + 1;
    }
    var bar = true
    if (bar) {
        Promise.resolve().then(() => {
            console.log(foo());
        });
    }
}

