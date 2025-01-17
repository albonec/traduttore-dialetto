let italianoWords = [];
let brescianoWords = [];

document.addEventListener('DOMContentLoaded', function() {
    fetch('dict.csv')
        .then(response => response.text())
        .then(data => {
            Papa.parse(data, {
                header: true,
                complete: function(results) {
                    [italianoWords, brescianoWords] = convertCSVToArrays(results.data);
                }
            });
        });
});

function convertCSVToArrays(data) {
    const italiano = [];
    const bresciano = [];

    data.forEach(row => {
        italiano.push(row.Italiano);
        bresciano.push(row.Bresciano);
    });

    return [italiano, bresciano];
}

function translateText() {
    const inputText = document.getElementById('inputText').value;
    const targetLanguage = document.getElementById('targetLanguage').value;

    if (targetLanguage === 'br') {
        const cleanedInputText = inputText.replace(/[^a-zA-Z\s]/g, ''); // Retain only letters and spaces
        const words = cleanedInputText.split(' ');

        const translatedWords = words.map(word => {
            const index = italianoWords.indexOf(word.toLowerCase());
            return index !== -1 ? brescianoWords[index] : word;
        });

        const translation = translatedWords.join(' ');
        document.getElementById('outputText').innerText = translation;
    }
}