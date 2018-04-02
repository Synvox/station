import React from 'react'
import { compose, branch, renderNothing } from 'recompose'
import { withData } from './client'

const enhancer = compose(
  withData(
    ({ user, scopes, topics, files, createTopic, upload }) => ({
      user,
      createTopic: async () => {
        const name = prompt('What name?')
        if (!name) return
        await createTopic({
          name,
          scopeId: Object.entries(scopes)
            .map(([_, scope]) => scope)
            .find(scope => scope.type === 'Domain').id
        })
      },
      upload: async () => {
        const files = [...document.querySelector('input[type="file"]').files]

        for (let file of files) {
          await upload(
            {
              name: file.name,
              type: file.type,
              size: file.size,
              scopeId: Object.entries(scopes)
                .map(([_, scope]) => scope)
                .find(scope => scope.type === 'Domain').id
            },
            file
          )
        }

        document.querySelector('input[type="file"]').value = null
      },
      topics: topics(
        Object.entries(scopes)
          .map(([_, scope]) => scope)
          .find(scope => scope.type === 'Domain').id
      ),
      files: files(
        Object.entries(scopes)
          .map(([_, scope]) => scope)
          .find(scope => scope.type === 'Domain').id
      )
    }),
    () => ({ user: { id: '' }, topics: {}, files: {} })
  ),
  branch(({ user }) => !user, renderNothing)
)

export default enhancer(({ user, topics, files, createTopic, upload }) => (
  <div>
    UserId:
    {user.id}
    <br />
    <br />
    Topics:<button onClick={createTopic}>New</button>
    <br />
    {Object.keys(topics)
      .map(x => topics[x])
      .map(x => <div key={x.id}>{x.name}</div>)}
    <br />
    Files:
    <input
      type="file"
      ref={e => (window.file = e)}
      onChange={upload}
      multiple
    />
    {Object.keys(files)
      .map(x => files[x])
      .map(x => <div key={x.id}>{x.name}</div>)}
  </div>
))
