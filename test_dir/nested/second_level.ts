function secondLevelFunction() {
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



function almostTheSameFunction() {
    let y = 1;
    const bar = () => {
        return y + 1;
    }
    var foo = true
    if (foo) {
        Promise.resolve().then(() => {
            console.log(bar());
        });
    }
}

