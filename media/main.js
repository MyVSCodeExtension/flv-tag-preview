
(function() {
    const vscode = acquireVsCodeApi();

    function renderTree(data, container) {
        for (const key in data) {
            const value = data[key];
            const li = document.createElement('li');
            
            if (typeof value === 'object' && value !== null) {
                const details = document.createElement('details');
                const summary = document.createElement('summary');
                summary.textContent = key;
                details.appendChild(summary);
                
                const ul = document.createElement('ul');
                renderTree(value, ul);
                details.appendChild(ul);
                li.appendChild(details);
            } else {
                li.textContent = `${key}: ${value}`;
            }
            container.appendChild(li);
        }
    }

    window.addEventListener('message', event => {
        const message = event.data;
        if (message.command === 'flvData') {
            const { header, tags, metadata } = message;

            const headerContainer = document.getElementById('header');
            const metadataContainer = document.getElementById('metadata');
            const tagsContainer = document.getElementById('tags');

            headerContainer.innerHTML = '';
            const headerUl = document.createElement('ul');
            renderTree(header, headerUl);
            headerContainer.appendChild(headerUl);

            metadataContainer.innerHTML = '';
            const metadataUl = document.createElement('ul');
            renderTree(metadata, metadataUl);
            metadataContainer.appendChild(metadataUl);

            tagsContainer.innerHTML = '';
            tags.forEach((tag, index) => {
                const details = document.createElement('details');
                const summary = document.createElement('summary');
                summary.textContent = `Tag ${index + 1}: ${tag.Type} @ ${tag.Timestamp}`;
                details.appendChild(summary);
                
                const ul = document.createElement('ul');
                renderTree(tag, ul);
                details.appendChild(ul);
                tagsContainer.appendChild(details);
            });
        }
    });
}());
